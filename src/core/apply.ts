/**
 * 把合并后的目标模型落盘到 Chrome 书签树。
 *
 * 顺序经过特殊设计：
 *   1. 创建（父先子后）
 *   2. 更新标题/网址
 *   3. 移动（把幸存节点先从待删文件夹里搬出来，否则 removeTree 会误杀）
 *   4. 排序（按目标顺序逐个 move 到目标下标）
 *   5. 删除（最后做，自顶向下整棵子树删除）
 * 所有写操作由调用方包裹在「静默锁」中，避免触发同步自激。
 */

import { CHROME_ROOT_ID, ROOT_UUIDS_BY_INDEX, ROOTS, ROOT_UUID } from '../shared/constants';
import type {
  BookmarkNode,
  IdMap,
  LocalItem,
  NodeMeta,
  RecycleEntry,
  SyncCounts,
  TreeNode,
  Tombstones,
} from '../shared/types';
import { nodeHash } from './ids';

export interface ApplyApi {
  getChildren(parentId: string): Promise<TreeNode[]>;
  create(args: { parentId: string; title: string; url?: string; index?: number }): Promise<{ id: string }>;
  update(id: string, changes: { title?: string; url?: string }): Promise<void>;
  move(id: string, args: { parentId: string; index: number }): Promise<void>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
}

export interface ApplyInput {
  target: BookmarkNode[];
  localItems: LocalItem[];
  ids: IdMap;
  tombs: Tombstones;
  now: number;
  api: ApplyApi;
  onRecycle: (entry: RecycleEntry) => void;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface ApplyOutput {
  counts: SyncCounts;
  ids: IdMap;
  tombs: Tombstones;
}

export async function applyTarget(input: ApplyInput): Promise<ApplyOutput> {
  const { target, localItems, api, now, onRecycle, onLog } = input;
  const ids: IdMap = {
    byUuid: { ...input.ids.byUuid },
    byChrome: { ...input.ids.byChrome },
    meta: { ...input.ids.meta },
  };
  const tombs: Tombstones = { ...input.tombs };

  const alive = target.filter((n) => !n.deletedAt && n.id !== ROOT_UUID);
  const aliveById = new Map(alive.map((n) => [n.id, n]));
  const localById = new Map(localItems.map((i) => [i.uuid, i]));
  const counts: SyncCounts = { created: 0, updated: 0, moved: 0, deleted: 0 };

  const childrenByParent = new Map<string, BookmarkNode[]>();
  for (const n of alive) {
    if (!n.parentId) continue;
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId, [n]);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.index - b.index || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // 根节点 id 随 profile 变化，运行时读取真实 id；读不到时退回清单默认值
  const rootChromeIds = new Map<string, string>();
  try {
    const rootChildren = await api.getChildren(CHROME_ROOT_ID);
    ROOT_UUIDS_BY_INDEX.forEach((uuid, i) => {
      const child = rootChildren[i];
      if (child) rootChromeIds.set(uuid, child.id);
    });
  } catch {
    /* 某些实现不暴露根节点，退回 ROOTS 默认 id */
  }
  for (const root of ROOTS) {
    const actual = rootChromeIds.get(root.uuid) ?? root.chromeId;
    rootChromeIds.set(root.uuid, actual);
    ids.byUuid[root.uuid] = actual;
    ids.byChrome[actual] = root.uuid;
  }

  const chromeIdOf = (uuid: string | null): string | null => {
    if (!uuid) return null;
    return rootChromeIds.get(uuid) ?? ids.byUuid[uuid] ?? null;
  };

  // ---------- 1. 创建 + 2. 更新（父先子后）----------
  const walkCreate = async (parentUuid: string, parentChromeId: string): Promise<void> => {
    const kids = childrenByParent.get(parentUuid) ?? [];
    for (const node of kids) {
      let chromeId = ids.byUuid[node.id];
      if (!chromeId) {
        try {
          const created = await api.create({
            parentId: parentChromeId,
            title: node.title,
            url: node.kind === 'bookmark' ? node.url : undefined,
            index: node.index,
          });
          chromeId = created.id;
          counts.created++;
          ids.byUuid[node.id] = chromeId;
          ids.byChrome[chromeId] = node.id;
        } catch (err) {
          onLog?.('error', `创建失败 ${node.title}: ${String(err)}`);
          continue;
        }
      } else {
        const local = localById.get(node.id);
        if (local && (local.title !== node.title || (local.url ?? '') !== (node.url ?? ''))) {
          try {
            if (node.kind === 'bookmark') {
              await api.update(chromeId, { title: node.title, url: node.url });
            } else {
              await api.update(chromeId, { title: node.title });
            }
            counts.updated++;
          } catch (err) {
            onLog?.('warn', `更新失败 ${node.title}: ${String(err)}`);
          }
        }
      }
      if (node.kind === 'folder') await walkCreate(node.id, chromeId);
    }
  };

  for (const root of ROOTS) {
    const chromeId = rootChromeIds.get(root.uuid);
    if (chromeId) await walkCreate(root.uuid, chromeId);
  }

  // ---------- 3. 移动（父节点变化）----------
  for (const node of alive) {
    const local = localById.get(node.id);
    if (!local || local.parentUuid === node.parentId) continue;
    const chromeId = ids.byUuid[node.id];
    const newParentChrome = chromeIdOf(node.parentId);
    if (!chromeId || !newParentChrome) continue;
    try {
      await api.move(chromeId, { parentId: newParentChrome, index: node.index });
      counts.moved++;
    } catch (err) {
      onLog?.('warn', `移动失败 ${node.title}: ${String(err)}`);
    }
  }

  // ---------- 4. 排序 ----------
  const foldersToOrder: string[] = [ROOTS.map((r) => r.uuid)[0]!, ROOTS.map((r) => r.uuid)[1]!, ROOTS.map((r) => r.uuid)[2]!];
  for (const n of alive) if (n.kind === 'folder') foldersToOrder.push(n.id);

  for (const folderUuid of foldersToOrder) {
    const parentChromeId = chromeIdOf(folderUuid);
    if (!parentChromeId) continue;
    let current: TreeNode[];
    try {
      current = await api.getChildren(parentChromeId);
    } catch {
      continue;
    }
    const currentUuids = current.map((c) => ids.byChrome[c.id]).filter(Boolean) as string[];
    const desired = (childrenByParent.get(folderUuid) ?? []).map((n) => n.id);

    for (let i = 0; i < desired.length; i++) {
      const want = desired[i]!;
      if (currentUuids[i] === want) continue;
      const chromeId = ids.byUuid[want];
      if (!chromeId) continue;
      try {
        await api.move(chromeId, { parentId: parentChromeId, index: i });
      } catch (err) {
        onLog?.('warn', `排序失败 ${want}: ${String(err)}`);
        continue;
      }
      const from = currentUuids.indexOf(want);
      if (from >= 0) currentUuids.splice(from, 1);
      currentUuids.splice(i, 0, want);
    }
  }

  // ---------- 5. 删除（最后做）----------
  const toDeleteSet = new Set(localItems.filter((i) => !aliveById.has(i.uuid)).map((i) => i.uuid));

  const hasDeletedAncestor = (item: LocalItem): boolean => {
    let cur = item.parentUuid;
    let guard = 0;
    while (cur && guard++ < 2000) {
      if (toDeleteSet.has(cur)) return true;
      cur = localById.get(cur)?.parentUuid ?? '';
    }
    return false;
  };

  for (const item of localItems) {
    if (!toDeleteSet.has(item.uuid)) continue;
    if (hasDeletedAncestor(item)) continue; // 由上层 removeTree 一并带走
    onRecycle({
      id: item.uuid,
      kind: item.kind,
      title: item.title,
      url: item.url,
      parentId: item.parentUuid,
      parentTitle: localById.get(item.parentUuid)?.title ?? '',
      deletedAt: now,
      reason: 'remote-delete',
    });
    try {
      if (item.kind === 'folder') await api.removeTree(item.chromeId);
      else await api.remove(item.chromeId);
    } catch (err) {
      onLog?.('warn', `删除失败 ${item.title}: ${String(err)}`);
      continue;
    }
    counts.deleted++;
    delete ids.byUuid[item.uuid];
    delete ids.byChrome[item.chromeId];
    delete ids.meta[item.uuid];
    tombs[item.uuid] = {
      deletedAt: now,
      parentId: item.parentUuid,
      title: item.title,
      kind: item.kind,
      url: item.url,
    };
  }

  // ---------- 6. 回写指纹 ----------
  for (const node of alive) {
    const prev = ids.meta[node.id];
    const meta: NodeMeta = {
      createdAt: prev?.createdAt ?? node.createdAt ?? now,
      updatedAt: node.updatedAt ?? now,
      hash: nodeHash({
        title: node.title,
        url: node.url,
        parentId: node.parentId,
        index: node.index,
        kind: node.kind,
      }),
    };
    ids.meta[node.id] = meta;
  }
  for (const root of ROOTS) {
    const prev = ids.meta[root.uuid];
    ids.meta[root.uuid] = {
      createdAt: prev?.createdAt ?? 0,
      updatedAt: 0,
      hash: nodeHash({ title: '', url: '', parentId: ROOT_UUID, index: 0, kind: 'folder' }),
    };
  }

  return { counts, ids, tombs };
}
