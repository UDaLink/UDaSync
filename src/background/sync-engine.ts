/**
 * 同步主流程：读本地树 → 拉全部设备快照 → 合并 → （首次需确认）→ 备份 → 落盘 → 上传本机快照。
 * 单一职责：编排。合并/落盘细节在 core 里，网络细节在 adapters 里。
 */

import {
  ALARM_RETRY,
  APP_NAME,
  BACKUP_MAX_FILES,
  BACKUP_MIN_INTERVAL_MS,
  FAILURE_NOTIFY_THRESHOLD,
  LOCAL_BACKUP_PREFIX,
  REMOTE_BACKUPS_DIR,
  REMOTE_DEVICES_DIR,
  ROOT_BAR,
  ROOT_UUID,
  ROOT_UUIDS_BY_INDEX,
  SCHEMA_VERSION,
  STORAGE_KEYS,
} from '../shared/constants';
import type {
  BookmarkNode,
  DeviceInfo,
  IdMap,
  LocalItem,
  PlanSummary,
  RecycleEntry,
  Snapshot,
  SyncResult,
  Tombstones,
  TreeNode,
} from '../shared/types';
import { JianguoyunAdapter } from '../adapters/jianguoyun';
import { applyTarget } from '../core/apply';
import { fingerprintNodes, buildModel } from '../core/model';
import { mergeNodes, tombstonesToNodes } from '../core/merge';
import { isLikelyLocalWipe, summarizeDiff } from '../core/plan';
import { createLocalBackupFolder } from '../core/local-backup';
import { bookmarkApi, getBookmarkTree } from '../platform/bookmarks';
import { setBadge } from '../platform/badge';
import { log } from '../platform/logger';
import {
  getConfig,
  getIds,
  getStats,
  getTombs,
  getUploadedHash,
  patchStats,
  pushRecycle,
  saveConfig,
  setIds,
  setTombs,
  setUploadedHash,
} from '../platform/settings';

export type SyncTrigger = 'manual' | 'auto' | 'poll' | 'startup' | 'retry' | 'confirm';

interface SyncOptions {
  /** false 时只做预览，不写书签、不上传 */
  apply: boolean;
  /** 首次同步确认后传 true */
  confirmedFirstRun?: boolean;
}

let inFlight = false;

export function isSyncing(): boolean {
  return inFlight;
}

export async function runSync(trigger: SyncTrigger, options: SyncOptions = { apply: true }): Promise<SyncResult> {
  if (inFlight) return { ok: false, error: '同步正在进行中，请稍候' };
  inFlight = true;
  await patchStats({ lastStatus: 'syncing', lastReason: trigger });
  await setBadge('syncing');
  try {
    return await doSync(trigger, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prev = await getStats();
    const stats = await patchStats({
      lastStatus: 'error',
      lastError: message,
      lastReason: trigger,
      lastSyncAt: Date.now(),
      consecutiveFailures: prev.consecutiveFailures + 1,
    });
    await setBadge('error');
    await log('error', `同步失败：${message}`, err instanceof Error ? err.stack : undefined);
    if (stats.consecutiveFailures >= FAILURE_NOTIFY_THRESHOLD) {
      await notifyFailure(message);
    }
    return { ok: false, error: message };
  } finally {
    inFlight = false;
    await clearApplyLock();
  }
}

async function doSync(trigger: SyncTrigger, options: SyncOptions): Promise<SyncResult> {
  const cfg = await getConfig();
  if (!cfg.account || !cfg.appPassword) {
    await patchStats({ lastStatus: 'error', lastError: '尚未绑定坚果云账号' });
    await setBadge('error');
    return { ok: false, error: '尚未绑定坚果云账号' };
  }
  if (cfg.paused && trigger !== 'manual' && trigger !== 'confirm') {
    return { ok: false, error: '同步已暂停' };
  }

  const adapter = new JianguoyunAdapter(cfg.baseUrl, cfg.account, cfg.appPassword, cfg.dir, (level, msg) =>
    void log(level, msg),
  );

  // 1) 连通性 + 目录
  await adapter.ping();
  await adapter.ensureDir(REMOTE_DEVICES_DIR);

  const now = Date.now();
  const [tree, ids, tombs] = await Promise.all([getBookmarkTree(), getIds(), getTombs()]);

  // 2) 本地模型
  const built = buildModel({ tree, ids, tombs, now });
  let localModel = built.model;
  let nextIds = built.ids;

  // 3) 拉取所有设备快照
  const entries = await adapter.list(REMOTE_DEVICES_DIR);
  const snapshots: Snapshot[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json.gz')) continue;
    try {
      const snapshot = await adapter.readJson<Snapshot>(`${REMOTE_DEVICES_DIR}/${entry.name}`);
      if (snapshot && Array.isArray(snapshot.nodes) && snapshot.schema === SCHEMA_VERSION) {
        snapshots.push(snapshot);
      }
    } catch (err) {
      await log('warn', `读取设备快照失败 ${entry.name}`, String(err));
    }
  }

  // 4) 重装/换机场景：用云端同父同名同网址节点吸附本地新 id，避免整棵重复
  const adopted = adoptOrphans(localModel, snapshots, nextIds);
  localModel = adopted.model;
  nextIds = adopted.ids;

  // 5) 合并
  const remoteNodes = snapshots.map((s) => s.nodes);
  const merged = mergeNodes(localModel.nodes, remoteNodes, now);
  const aliveTarget = merged.alive;

  // 6) 差异
  const summary = summarizeDiff(localModel.items, aliveTarget);
  const hasChanges =
    summary.create + summary.update + summary.move + summary.reorder + summary.remove > 0;

  const isFirstMerge = !cfg.firstRunDone && snapshots.length > 0;
  if (isFirstMerge && !options.confirmedFirstRun) {
    await patchStats({ lastStatus: 'preview', pendingPreview: summary, devices: collectDevices(snapshots, cfg.deviceId, cfg.deviceName) });
    await setBadge('ok');
    return {
      ok: true,
      needsConfirm: true,
      summary,
      at: now,
    };
  }

  if (!options.apply) {
    await patchStats({ lastStatus: 'ok' });
    return { ok: true, summary, at: now };
  }

  // 保护：本机书签被浏览器清空时，不要把它当成"用户删除了全部书签"
  const localAlive = localModel.nodes.filter((n) => !n.deletedAt && n.id !== ROOT_UUID && !ROOT_UUIDS_BY_INDEX.includes(n.id)).length;
  const remoteAlive = snapshots.reduce((sum, s) => sum + s.nodes.filter((n) => !n.deletedAt && n.id !== ROOT_UUID && !ROOT_UUIDS_BY_INDEX.includes(n.id)).length, 0);
  if (isLikelyLocalWipe(localAlive, remoteAlive, !!options.confirmedFirstRun)) {
    const msg = `检测到本机书签异常清空（本机 ${localAlive} 项，云端 ${remoteAlive} 项），已停止同步以避免误删云端数据。请先恢复本机书签，或在确认无误后重新走首次合并确认。`;
    await log('error', msg);
    await patchStats({ lastStatus: 'error', lastError: msg, lastReason: trigger });
    await setBadge('error');
    return { ok: false, error: msg };
  }

  // 7) 首次同步：先备份本地整棵树到书签栏（不参与同步）
  if (!cfg.firstRunDone) {
    try {
      const barChromeId = nextIds.byUuid[ROOT_BAR] ?? '1';
      const backup = await createLocalBackupFolder(bookmarkApi, cfg.deviceName, new Date(now), barChromeId);
      await log('info', `已创建本机备份文件夹 ${LOCAL_BACKUP_PREFIX}（${backup.count} 项）`);
    } catch (err) {
      await log('warn', '本机备份文件夹创建失败，继续同步', err instanceof Error ? `${err.message}` : String(err));
    }
  }

  // 8) 云端备份（有变更时，最多每 5 分钟一次）
  const statsBefore = await getStats();
  const needBackup =
    hasChanges && (!statsBefore.lastBackupAt || now - statsBefore.lastBackupAt > BACKUP_MIN_INTERVAL_MS);
  if (needBackup) {
    await writeCloudBackup(adapter, localModel.nodes, now);
    await patchStats({ lastBackupAt: now });
  }

  // 9) 落盘
  const recycle: RecycleEntry[] = [];
  let nextTombs: Tombstones = built.tombs;
  let counts = { created: 0, updated: 0, moved: 0, deleted: 0 };

  if (hasChanges) {
    await setApplyLock(now);
    const applied = await applyTarget({
      target: aliveTarget,
      localItems: localModel.items,
      ids: nextIds,
      tombs: nextTombs,
      now,
      api: bookmarkApi,
      onRecycle: (entry) => recycle.push(entry),
      onLog: (level, msg) => void log(level, msg),
    });
    counts = applied.counts;
    nextIds = applied.ids;
    nextTombs = applied.tombs;
  }

  // 合并后的墓碑表同步回本地存储（含远端删除与本地删除）
  const mergedTombs: Tombstones = { ...nextTombs, ...merged.newTombstones };

  await setIds(nextIds);
  await setTombs(pruneTombs(mergedTombs, now));
  if (recycle.length) await pushRecycle(recycle);

  // 10) 上传本机快照
  const snapshotNodes = aliveTarget
    .filter((n) => n.id !== ROOT_UUID)
    .concat(Object.keys(mergedTombs).length ? tombstonesToNodes(pruneTombs(mergedTombs, now)) : []);
  const snapshot: Snapshot = {
    schema: SCHEMA_VERSION,
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    generatedAt: now,
    nodes: snapshotNodes,
  };
  const snapshotHash = fingerprintNodes(snapshotNodes);
  const uploadedHash = await getUploadedHash();
  if (snapshotHash !== uploadedHash) {
    await adapter.writeJson(`${REMOTE_DEVICES_DIR}/${cfg.deviceId}.json.gz`, snapshot);
    await setUploadedHash(snapshotHash);
  }

  // 11) 状态
  const devices = collectDevices(snapshots, cfg.deviceId, cfg.deviceName, snapshotNodes.length);
  await patchStats({
    lastSyncAt: now,
    lastStatus: 'ok',
    lastError: null,
    lastReason: trigger,
    lastCounts: counts,
    consecutiveFailures: 0,
    devices,
    pendingPreview: null,
  });
  await setBadge('ok');
  if (!cfg.firstRunDone) await saveConfig({ firstRunDone: true, connectedAt: cfg.connectedAt ?? now });

  await log(
    'info',
    `同步完成（${trigger}）：新建 ${counts.created}，更新 ${counts.updated}，移动 ${counts.moved}，删除 ${counts.deleted}`,
  );
  return { ok: true, counts, summary, at: now };
}

/** 云端备份文件：backups/20261126-2130.json.gz，最多留 10 份 */
async function writeCloudBackup(adapter: JianguoyunAdapter, nodes: BookmarkNode[], now: number): Promise<void> {
  try {
    await adapter.ensureDir(REMOTE_BACKUPS_DIR);
    const d = new Date(now);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const name = `${stamp}.json.gz`;
    await adapter.writeJson(`${REMOTE_BACKUPS_DIR}/${name}`, {
      schema: SCHEMA_VERSION,
      deviceId: 'backup',
      deviceName: APP_NAME,
      generatedAt: now,
      nodes,
    } satisfies Snapshot);

    const files = await adapter.list(REMOTE_BACKUPS_DIR);
    const sorted = files.filter((f) => f.name.endsWith('.json.gz')).sort((a, b) => a.name.localeCompare(b.name));
    for (const f of sorted.slice(0, Math.max(0, sorted.length - BACKUP_MAX_FILES))) {
      await adapter.remove(`${REMOTE_BACKUPS_DIR}/${f.name}`);
    }
  } catch (err) {
    await log('warn', '云端备份失败（不阻塞本次同步）', String(err));
  }
}

/** 把远端已有节点按「父节点 + 类型 + 标题 + 网址」吸附到本地新 id（重装/换机会话） */
function adoptOrphans(
  model: { items: LocalItem[]; nodes: BookmarkNode[]; removedUuids: string[]; freshUuids: string[] },
  snapshots: Snapshot[],
  ids: IdMap,
): { model: typeof model; ids: IdMap } {
  if (!snapshots.length || !model.freshUuids.length) return { model, ids };
  const fresh = new Set(model.freshUuids);

  const remoteByKey = new Map<string, BookmarkNode>();
  for (const s of snapshots) {
    for (const n of s.nodes) {
      if (n.deletedAt) continue;
      const key = `${n.parentId}\u0000${n.kind}\u0000${n.title}\u0000${n.url ?? ''}`;
      if (!remoteByKey.has(key)) remoteByKey.set(key, n);
    }
  }

  const nextIds: IdMap = { byUuid: { ...ids.byUuid }, byChrome: { ...ids.byChrome }, meta: { ...ids.meta } };
  const remap = new Map<string, string>();
  const adopted = new Map<string, BookmarkNode>();
  const claimed = new Set<string>();

  // BFS 顺序保证父节点先吸附；子节点匹配时使用改写后的 parentUuid
  for (const item of model.items) {
    const parent = remap.get(item.parentUuid) ?? item.parentUuid;
    item.parentUuid = parent;
    if (!fresh.has(item.uuid)) continue;

    const key = `${parent}\u0000${item.kind}\u0000${item.title}\u0000${item.url ?? ''}`;
    const candidate = remoteByKey.get(key);
    if (!candidate || claimed.has(candidate.id)) continue;
    claimed.add(candidate.id);
    remap.set(item.uuid, candidate.id);
    adopted.set(item.uuid, candidate);

    delete nextIds.byUuid[item.uuid];
    delete nextIds.byChrome[item.chromeId];
    nextIds.byUuid[candidate.id] = item.chromeId;
    nextIds.byChrome[item.chromeId] = candidate.id;
    nextIds.meta[candidate.id] = {
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      hash: '',
    };
    item.uuid = candidate.id;
  }

  if (!remap.size) return { model, ids };

  for (const node of model.nodes) {
    const target = remap.get(node.id);
    if (target) {
      const info = adopted.get(node.id);
      node.id = target;
      if (info) {
        node.createdAt = info.createdAt;
        node.updatedAt = info.updatedAt;
      }
    }
    if (node.parentId) {
      const mappedParent = remap.get(node.parentId);
      if (mappedParent) node.parentId = mappedParent;
    }
  }
  return { model, ids: nextIds };
}

function collectDevices(
  snapshots: Snapshot[],
  ownId: string,
  ownName: string,
  ownNodes?: number,
): DeviceInfo[] {
  const list: DeviceInfo[] = snapshots.map((s) => ({
    id: s.deviceId,
    name: s.deviceName,
    lastSyncAt: s.generatedAt,
    nodes: s.nodes.filter((n) => !n.deletedAt).length,
  }));
  if (!list.some((d) => d.id === ownId)) {
    list.push({ id: ownId, name: ownName, lastSyncAt: Date.now(), nodes: ownNodes ?? 0 });
  }
  return list.sort((a, b) => b.lastSyncAt - a.lastSyncAt);
}

function pruneTombs(tombs: Tombstones, now: number): Tombstones {
  const out: Tombstones = {};
  for (const [id, t] of Object.entries(tombs)) {
    if (now - t.deletedAt < 30 * 24 * 60 * 60 * 1000) out[id] = t;
  }
  return out;
}

async function setApplyLock(now: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.applyLock]: { until: now + 60_000 } });
}

export async function clearApplyLock(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.applyLock]: null });
}

export async function isApplyLocked(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.applyLock);
  const lock = stored[STORAGE_KEYS.applyLock] as { until?: number } | null | undefined;
  return !!lock?.until && lock.until > Date.now();
}

async function notifyFailure(message: string): Promise<void> {
  try {
    await chrome.notifications.create('udasyn-failure', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'UDaSync 同步失败',
      message: message.slice(0, 200),
      priority: 1,
    });
  } catch {
    /* 通知不可用不影响主流程 */
  }
}

/** 供 UI 调用：删除某台设备的云端快照 */
export async function removeDeviceSnapshot(deviceId: string): Promise<void> {
  const cfg = await getConfig();
  const adapter = new JianguoyunAdapter(cfg.baseUrl, cfg.account, cfg.appPassword, cfg.dir, (l, m) =>
    void log(l, m),
  );
  await adapter.remove(`${REMOTE_DEVICES_DIR}/${deviceId}.json.gz`);
  await log('info', `已移除设备快照 ${deviceId}`);
}

/** 备份文件列表 */
export async function listBackups(): Promise<Array<{ name: string; lastModified: string | null; size: number }>> {
  const cfg = await getConfig();
  const adapter = new JianguoyunAdapter(cfg.baseUrl, cfg.account, cfg.appPassword, cfg.dir, () => undefined);
  const files = await adapter.list(REMOTE_BACKUPS_DIR);
  return files.filter((f) => f.name.endsWith('.json.gz')).sort((a, b) => b.name.localeCompare(a.name));
}

/** 从云端备份恢复：把备份里存活的节点“顶”到当前时间，并入本机（不做删除） */
export async function restoreBackup(name: string): Promise<SyncResult> {
  const cfg = await getConfig();
  const adapter = new JianguoyunAdapter(cfg.baseUrl, cfg.account, cfg.appPassword, cfg.dir, (l, m) =>
    void log(l, m),
  );
  const snapshot = await adapter.readJson<Snapshot>(`${REMOTE_BACKUPS_DIR}/${name}`);
  if (!snapshot?.nodes?.length) return { ok: false, error: '备份文件为空或格式不支持' };

  const now = Date.now();
  const [tree, ids, tombs] = await Promise.all([getBookmarkTree(), getIds(), getTombs()]);
  const built = buildModel({ tree, ids, tombs: {}, now });
  const backupNodes: BookmarkNode[] = snapshot.nodes.map((n) => ({
    ...n,
    updatedAt: n.deletedAt ? n.updatedAt : now,
  }));
  const merged = mergeNodes(built.model.nodes, [backupNodes], now);
  const alive = merged.alive.filter((n) => n.id !== ROOT_UUID);
  const summary = summarizeDiff(built.model.items, alive);

  await setApplyLock(now);
  const applied = await applyTarget({
    target: alive,
    localItems: built.model.items,
    ids: built.ids,
    tombs: built.tombs,
    now,
    api: bookmarkApi,
    onRecycle: () => undefined,
    onLog: (level, msg) => void log(level, msg),
  });
  await setIds(applied.ids);
  await log('info', `已从备份 ${name} 恢复：新建 ${applied.counts.created}，更新 ${applied.counts.updated}`);
  await clearApplyLock();
  return { ok: true, counts: applied.counts, summary };
}

export type { TreeNode, PlanSummary };
