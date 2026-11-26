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
import type { SyncResult } from '../shared/types';
import { WebDavClient } from '../adapters/webdav';
import { setBadge } from '../platform/badge';
import { log } from '../platform/logger';
import {
  clearCredentials,
  getConfig,
  getIds,
  getLogs,
  getRecycle,
  getStats,
  patchStats,
  saveConfig,
  setRecycle,
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
      if (cfg.paused || !cfg.account || !cfg.appPassword) return;
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
  if (cfg.paused || !cfg.account || !cfg.appPassword) return;
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
    if (cfg.account && cfg.appPassword && cfg.firstRunDone && !cfg.paused) {
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
    case 'DISCONNECT':
      await clearCredentials();
      await setBadge('ok');
      await patchStats({ lastStatus: 'idle', pendingPreview: null, devices: [] });
      return { ok: true };
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
  return {
    ok: true,
    config: {
      baseUrl: cfg.baseUrl,
      account: cfg.account,
      dir: cfg.dir,
      deviceId: cfg.deviceId,
      deviceName: cfg.deviceName,
      paused: cfg.paused,
      firstRunDone: cfg.firstRunDone,
      connectedAt: cfg.connectedAt,
      hasCredentials: Boolean(cfg.account && cfg.appPassword),
    },
    stats,
    syncing: isSyncing(),
  };
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

  const changed = account !== cfg.account || appPassword !== cfg.appPassword || dir !== cfg.dir;
  await saveConfig({
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
