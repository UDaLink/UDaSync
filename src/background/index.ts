/**
 * Service Worker 入口：事件订阅 + 调度 + UI 消息路由。
 * 所有真正的同步逻辑都在 sync-engine 里，这里只做「什么时候同步」。
 */

import {
  ALARM_POLL,
  ALARM_RETRY,
  CHANGE_DEBOUNCE_MS,
  POLL_PERIOD_MINUTES,
  STORAGE_KEYS,
} from '../shared/constants';
import type { DeviceCodeInfo, StorageProvider, SyncResult } from '../shared/types';
import { WebDavClient } from '../adapters/webdav';
import { pollDeviceCode, startDeviceCode } from '../adapters/onedrive-auth';
import { setBadge } from '../platform/badge';
import { log } from '../platform/logger';
import {
  clearCredentials,
  getConfig,
  getIds,
  getLogs,
  getOneDriveTokens,
  getRecycle,
  getStats,
  hasCredentials,
  patchStats,
  saveConfig,
  setOneDriveTokens,
  setRecycle,
  setUploadedHash,
} from '../platform/settings';
import { ROOT_BAR } from '../shared/constants';
import {
  isApplyLocked,
  isSyncing,
  listBackups,
  removeDeviceSnapshot,
  restoreBackup,
  runSync,
} from './sync-engine';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 事件触发的合并窗口：连续编辑只在 5 秒后跑一次 */
function scheduleSync(reason: 'auto', delayMs = CHANGE_DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void (async () => {
      if (await isApplyLocked()) return; // 自己刚写的书签，不回环
      if (await isSyncing()) {
        scheduleSync('auto', 3000);
        return;
      }
      const cfg = await getConfig();
      if (cfg.paused || !(await hasCredentials(cfg))) return;
      const result = await runSync('auto', { apply: true });
      if (!result.ok && !result.needsConfirm) {
        // 失败交给轮询/重试闹钟，不在这里重排
        await log('warn', `自动同步失败：${result.error}`);
      }
    })();
  }, delayMs);
}

async function ensureAlarms(): Promise<void> {
  const existing = await chrome.alarms.getAll();
  if (!existing.some((a) => a.name === ALARM_POLL)) {
    await chrome.alarms.create(ALARM_POLL, { periodInMinutes: POLL_PERIOD_MINUTES });
  }
}

async function syncFromAlarm(name: string): Promise<void> {
  if (name !== ALARM_POLL && name !== ALARM_RETRY) return;
  if (await isApplyLocked()) return;
  if (await isSyncing()) return;
  const cfg = await getConfig();
  if (cfg.paused || !(await hasCredentials(cfg))) return;
  if (!cfg.firstRunDone) return; // 首次必须由用户确认
  const stats = await getStats();
  if (stats.consecutiveFailures > 0) {
    // 指数退避：失败后 1、2、4…最高 10 分钟再试
    const backoff = Math.min(10, 2 ** stats.consecutiveFailures) * 60 * 1000;
    if (stats.lastSyncAt && Date.now() - stats.lastSyncAt < backoff) return;
  }
  await runSync(name === ALARM_POLL ? 'poll' : 'retry', { apply: true });
}

// ---------------- 事件订阅 ----------------

chrome.runtime.onInstalled.addListener((details) => {
  void ensureAlarms();
  void log('info', `扩展已安装/更新：${details.reason}`);
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms();
  void (async () => {
    const cfg = await getConfig();
    if ((await hasCredentials(cfg)) && cfg.firstRunDone && !cfg.paused) {
      await runSync('startup', { apply: true });
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void syncFromAlarm(alarm.name);
});

chrome.bookmarks.onCreated.addListener(() => void scheduleSync('auto'));
chrome.bookmarks.onRemoved.addListener(() => void scheduleSync('auto'));
chrome.bookmarks.onChanged.addListener(() => void scheduleSync('auto'));
chrome.bookmarks.onMoved.addListener(() => void scheduleSync('auto'));
chrome.bookmarks.onChildrenReordered.addListener(() => void scheduleSync('auto'));
chrome.bookmarks.onImportEnded.addListener(() => void scheduleSync('auto', 1000));

// ---------------- UI 消息 ----------------

interface Msg {
  type: string;
  [key: string]: unknown;
}

chrome.runtime.onMessage.addListener((message: Msg, _sender, sendResponse) => {
  void handleMessage(message)
    .then((res) => sendResponse(normalizeResponse(res)))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

/** 把所有返回值统一成 { ok, data?, error? } 信封，UI 侧只认这一种形状 */
function normalizeResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.ok !== 'boolean') return raw;
  const { ok, error, data, ...rest } = obj;
  const payload = data ?? (Object.keys(rest).length ? rest : undefined);
  return {
    ok,
    ...(error ? { error } : {}),
    ...(payload === undefined ? {} : { data: payload }),
  };
}

async function handleMessage(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case 'GET_STATE':
      return getState();
    case 'TEST_CONNECTION':
      return testConnection(msg);
    case 'SAVE_CONFIG':
      return saveConnection(msg);
    case 'SET_PROVIDER': {
      const provider = String(msg.provider ?? '') as StorageProvider;
      if (provider !== 'jianguoyun' && provider !== 'onedrive') {
        return { ok: false, error: '未知的存储服务' };
      }
      const cfg = await getConfig();
      if (cfg.provider !== provider) {
        await saveConfig({ provider, firstRunDone: false, connectedAt: null });
        await setUploadedHash(null);
        await patchStats({ lastStatus: 'idle', pendingPreview: null, devices: [] });
      }
      return { ok: true };
    }
    case 'ONEDRIVE_BEGIN_AUTH':
      return beginOneDriveAuth(msg);
    case 'ONEDRIVE_POLL_AUTH':
      return pollOneDriveAuth(msg);
    case 'ONEDRIVE_DISCONNECT':
      await clearCredentials('onedrive');
      await setUploadedHash(null);
      await setBadge('ok');
      await patchStats({ lastStatus: 'idle', pendingPreview: null, devices: [] });
      return { ok: true };
    case 'SYNC_NOW': {
      const cfg = await getConfig();
      const result = await runSync('manual', { apply: true });
      if (!result.ok && result.error === '同步已暂停') {
        await patchStats({ lastStatus: cfg.paused ? 'idle' : 'error' });
      }
      return result;
    }
    case 'CONFIRM_FIRST_SYNC':
      return runSync('confirm', { apply: true, confirmedFirstRun: true });
    case 'SET_PAUSED': {
      const paused = Boolean(msg.paused);
      await saveConfig({ paused });
      await setBadge(paused ? 'paused' : 'ok');
      return { ok: true };
    }
    case 'RENAME_DEVICE': {
      const name = String(msg.name ?? '').trim();
      if (!name) return { ok: false, error: '设备名不能为空' };
      await saveConfig({ deviceName: name.slice(0, 40) });
      return { ok: true };
    }
    case 'DELETE_DEVICE':
      await removeDeviceSnapshot(String(msg.deviceId ?? ''));
      return { ok: true };
    case 'LIST_BACKUPS':
      return { ok: true, backups: await listBackups() };
    case 'RESTORE_BACKUP':
      return restoreBackup(String(msg.name ?? ''));
    case 'LIST_RECYCLE': {
      const list = await getRecycle();
      return { ok: true, items: list.sort((a, b) => b.deletedAt - a.deletedAt) };
    }
    case 'RESTORE_RECYCLE': {
      return restoreRecycle(String(msg.id ?? ''));
    }
    case 'GET_LOGS':
      return { ok: true, logs: await getLogs() };
    case 'CLEAR_LOGS':
      await chrome.storage.local.set({ [STORAGE_KEYS.logs]: [] });
      return { ok: true };
    case 'DISCONNECT': {
      const cfg = await getConfig();
      await clearCredentials(cfg.provider);
      await setUploadedHash(null);
      await setBadge('ok');
      await patchStats({ lastStatus: 'idle', pendingPreview: null, devices: [] });
      return { ok: true };
    }
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: `未知消息类型：${msg.type}` };
  }
}

async function getState() {
  const cfg = await getConfig();
  const stats = await getStats();
  const oneDriveTokens = await getOneDriveTokens();
  return {
    ok: true,
    config: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      account: cfg.account,
      dir: cfg.dir,
      oneDriveClientId: cfg.oneDriveClientId,
      oneDriveAccount: cfg.oneDriveAccount,
      oneDriveDir: cfg.oneDriveDir,
      deviceId: cfg.deviceId,
      deviceName: cfg.deviceName,
      paused: cfg.paused,
      firstRunDone: cfg.firstRunDone,
      connectedAt: cfg.connectedAt,
      hasCredentials: await hasCredentials(cfg),
      hasJianguoyunCredentials: Boolean(cfg.account && cfg.appPassword),
      hasOneDriveCredentials: Boolean(oneDriveTokens?.refreshToken),
    },
    stats,
    syncing: isSyncing(),
  };
}

async function beginOneDriveAuth(msg: Msg) {
  const cfg = await getConfig();
  const clientId = String(msg.clientId ?? cfg.oneDriveClientId).trim();
  if (!clientId) return { ok: false, error: '请先填写 OneDrive 的 Entra client ID' };
  try {
    const info: DeviceCodeInfo = await startDeviceCode(clientId);
    await saveConfig({ oneDriveClientId: clientId });
    return { ok: true, ...info };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function pollOneDriveAuth(msg: Msg) {
  const cfg = await getConfig();
  const clientId = cfg.oneDriveClientId.trim();
  const deviceCode = String(msg.deviceCode ?? '');
  if (!clientId) return { ok: false, error: 'OneDrive client ID 已丢失，请重新开始连接' };
  if (!deviceCode) return { ok: false, error: 'OneDrive 登录代码为空' };
  try {
    const result = await pollDeviceCode(clientId, deviceCode);
    if (result.status === 'pending') return { ok: true, status: 'pending' };
    if (result.status === 'slow_down') return { ok: true, status: 'slow_down', interval: result.interval };

    await setOneDriveTokens(result.tokens);
    await saveConfig({
      provider: 'onedrive',
      oneDriveAccount: result.tokens.account,
      connectedAt: Date.now(),
      firstRunDone: false,
    });
    await setUploadedHash(null);
    await setBadge('ok');
    await patchStats({ lastStatus: 'idle', pendingPreview: null, devices: [] });
    return { ok: true, status: 'ok', account: result.tokens.account };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testConnection(msg: Msg) {
  const baseUrl = String(msg.baseUrl ?? '').trim();
  const account = String(msg.account ?? '').trim();
  const appPassword = String(msg.appPassword ?? '');
  if (!baseUrl || !account || !appPassword) return { ok: false, error: '请填写完整的服务器地址、账号与应用密码' };
  try {
    const client = new WebDavClient({ baseUrl, account, appPassword });
    const ping = await client.ping();
    return { ok: true, entries: ping.entries.map((e: { name: string }) => e.name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function saveConnection(msg: Msg): Promise<SyncResult> {
  const baseUrl = String(msg.baseUrl ?? '').trim();
  const account = String(msg.account ?? '').trim();
  const typedPassword = String(msg.appPassword ?? '').trim();
  const cfg = await getConfig();
  const appPassword = typedPassword || cfg.appPassword;

  if (!baseUrl.startsWith('https://')) return { ok: false, error: '服务器地址必须以 https:// 开头' };
  if (!account) return { ok: false, error: '账号不能为空' };
  if (!appPassword) return { ok: false, error: '应用密码不能为空' };

  const dir = typeof msg.dir === 'string' && msg.dir.trim() ? msg.dir.trim() : cfg.dir;
  if (!/^[A-Za-z0-9._-]+$/.test(dir)) {
    return { ok: false, error: '云端目录只能是 ASCII 字母、数字、点、下划线和短横线（坚果云不支持中文路径）' };
  }

  const changed = cfg.provider !== 'jianguoyun' || account !== cfg.account || appPassword !== cfg.appPassword || dir !== cfg.dir;
  if (changed) await setUploadedHash(null);
  await saveConfig({
    provider: 'jianguoyun',
    baseUrl,
    account,
    appPassword,
    dir,
    connectedAt: Date.now(),
    ...(changed ? { firstRunDone: false } : {}),
  });

  const result = await runSync('manual', { apply: true });
  return result;
}

async function restoreRecycle(id: string) {
  const list = await getRecycle();
  const entry = list.find((e) => e.id === id);
  if (!entry) return { ok: false, error: '回收站条目不存在或已过期' };

  // 原父节点在本地已被删除，统一恢复到书签栏，用户可再拖到想要的位置
  const ids = await getIds();
  const parentId = ids.byUuid[ROOT_BAR] ?? '1';

  try {
    if (entry.kind === 'folder') {
      await chrome.bookmarks.create({ parentId, title: entry.title });
    } else {
      await chrome.bookmarks.create({ parentId, title: entry.title, url: entry.url });
    }
  } catch (err) {
    return { ok: false, error: `恢复失败：${err instanceof Error ? err.message : String(err)}` };
  }

  await setRecycle(list.filter((e) => e.id !== id));
  await log('info', `已恢复：${entry.title}`);
  return { ok: true };
}
