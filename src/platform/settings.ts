/** chrome.storage 之上的薄封装：集中默认值，避免各模块各写一套 key。 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_ONEDRIVE_CLIENT_ID,
  DEFAULT_ONEDRIVE_DIR,
  DEFAULT_REMOTE_DIR,
  RECYCLE_MAX,
  RECYCLE_TTL_MS,
  STORAGE_KEYS,
} from '../shared/constants';
import type {
  IdMap,
  LogEntry,
  OneDriveTokens,
  RecycleEntry,
  StorageProvider,
  SyncStats,
  Tombstones,
  UdasynConfig,
} from '../shared/types';
import { uuid } from '../core/ids';

const EMPTY_IDS: IdMap = { byUuid: {}, byChrome: {}, meta: {} };
const EMPTY_STATS: SyncStats = {
  lastSyncAt: null,
  lastStatus: 'idle',
  lastError: null,
  lastReason: null,
  lastCounts: { created: 0, updated: 0, moved: 0, deleted: 0 },
  consecutiveFailures: 0,
  devices: [],
  lastBackupAt: null,
  pendingPreview: null,
};

function detectDeviceName(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  const brand = ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome' : 'Chromium';
  const os = ua.includes('Macintosh') || ua.includes('Mac OS X') ? 'Mac' : ua.includes('Windows') ? 'Windows' : 'Linux';
  return `${brand}@${os}`;
}

export async function getConfig(): Promise<UdasynConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.config);
  const cfg = stored[STORAGE_KEYS.config] as Partial<UdasynConfig> | undefined;
  const provider: StorageProvider =
    cfg?.provider === 'onedrive'
      ? 'onedrive'
      : cfg?.provider === 'pan123'
        ? 'pan123'
        : cfg?.provider === 'webdav'
          ? 'webdav'
          : 'jianguoyun';
  const merged: UdasynConfig = {
    provider,
    baseUrl: cfg?.baseUrl ?? DEFAULT_BASE_URL,
    account: cfg?.account ?? '',
    appPassword: cfg?.appPassword ?? '',
    webdavUrl: cfg?.webdavUrl ?? '',
    webdavAccount: cfg?.webdavAccount ?? '',
    webdavPassword: cfg?.webdavPassword ?? '',
    pan123Account: cfg?.pan123Account ?? '',
    pan123Password: cfg?.pan123Password ?? '',
    dir: cfg?.dir ?? DEFAULT_REMOTE_DIR,
    oneDriveClientId: cfg?.oneDriveClientId ?? DEFAULT_ONEDRIVE_CLIENT_ID,
    oneDriveAccount: cfg?.oneDriveAccount ?? '',
    oneDriveDir: cfg?.oneDriveDir ?? DEFAULT_ONEDRIVE_DIR,
    deviceId: cfg?.deviceId ?? uuid(),
    deviceName: cfg?.deviceName ?? detectDeviceName(),
    paused: cfg?.paused ?? false,
    firstRunDone: cfg?.firstRunDone ?? false,
    connectedAt: cfg?.connectedAt ?? null,
  };
  if (!cfg || !cfg.deviceId || cfg.provider !== provider) {
    await chrome.storage.local.set({ [STORAGE_KEYS.config]: merged });
  }
  return merged;
}

export async function saveConfig(patch: Partial<UdasynConfig>): Promise<UdasynConfig> {
  const cur = await getConfig();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.config]: next });
  return next;
}

export async function clearCredentials(provider?: StorageProvider): Promise<void> {
  const cur = await getConfig();
  const target = provider ?? cur.provider;
  if (target === 'onedrive') {
    await chrome.storage.local.remove(STORAGE_KEYS.oneDriveAuth);
    await chrome.storage.local.set({
      [STORAGE_KEYS.config]: {
        ...cur,
        oneDriveAccount: '',
        connectedAt: null,
        firstRunDone: false,
      },
    });
    return;
  }
  if (target === 'webdav') {
    await chrome.storage.local.set({
      [STORAGE_KEYS.config]: {
        ...cur,
        webdavAccount: '',
        webdavPassword: '',
        connectedAt: null,
        firstRunDone: false,
      },
    });
    return;
  }
  if (target === 'pan123') {
    await chrome.storage.local.set({
      [STORAGE_KEYS.config]: {
        ...cur,
        pan123Account: '',
        pan123Password: '',
        connectedAt: null,
        firstRunDone: false,
      },
    });
    return;
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.config]: {
      ...cur,
      account: '',
      appPassword: '',
      connectedAt: null,
      firstRunDone: false,
    },
  });
}

export async function getOneDriveTokens(): Promise<OneDriveTokens | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.oneDriveAuth);
  return (stored[STORAGE_KEYS.oneDriveAuth] as OneDriveTokens | undefined) ?? null;
}

export async function setOneDriveTokens(tokens: OneDriveTokens | null): Promise<void> {
  if (!tokens) {
    await chrome.storage.local.remove(STORAGE_KEYS.oneDriveAuth);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.oneDriveAuth]: tokens });
}

export async function hasCredentials(cfg?: UdasynConfig): Promise<boolean> {
  const cur = cfg ?? (await getConfig());
  if (cur.provider === 'onedrive') {
    const tokens = await getOneDriveTokens();
    return Boolean(tokens?.refreshToken);
  }
  if (cur.provider === 'webdav') {
    return Boolean(cur.webdavUrl && cur.webdavAccount && cur.webdavPassword);
  }
  if (cur.provider === 'pan123') {
    return Boolean(cur.pan123Account && cur.pan123Password);
  }
  return Boolean(cur.account && cur.appPassword);
}

export async function getIds(): Promise<IdMap> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.ids);
  return (stored[STORAGE_KEYS.ids] as IdMap | undefined) ?? EMPTY_IDS;
}

export async function setIds(ids: IdMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.ids]: ids });
}

export async function getTombs(): Promise<Tombstones> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.tombs);
  return (stored[STORAGE_KEYS.tombs] as Tombstones | undefined) ?? {};
}

export async function setTombs(tombs: Tombstones): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.tombs]: tombs });
}

export async function getStats(): Promise<SyncStats> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.stats);
  return { ...EMPTY_STATS, ...((stored[STORAGE_KEYS.stats] as Partial<SyncStats> | undefined) ?? {}) };
}

export async function patchStats(patch: Partial<SyncStats>): Promise<SyncStats> {
  const cur = await getStats();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.stats]: next });
  return next;
}

export async function appendLog(entry: LogEntry): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.logs);
  const list = ((stored[STORAGE_KEYS.logs] as LogEntry[] | undefined) ?? []).concat(entry).slice(-200);
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: list });
}

export async function getLogs(): Promise<LogEntry[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.logs);
  return (stored[STORAGE_KEYS.logs] as LogEntry[] | undefined) ?? [];
}

export async function pushRecycle(entries: RecycleEntry[]): Promise<void> {
  if (!entries.length) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.recycle);
  const now = Date.now();
  const list = ((stored[STORAGE_KEYS.recycle] as RecycleEntry[] | undefined) ?? [])
    .filter((e) => now - e.deletedAt < RECYCLE_TTL_MS)
    .concat(entries)
    .slice(-RECYCLE_MAX);
  await chrome.storage.local.set({ [STORAGE_KEYS.recycle]: list });
}

export async function getRecycle(): Promise<RecycleEntry[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.recycle);
  const now = Date.now();
  return ((stored[STORAGE_KEYS.recycle] as RecycleEntry[] | undefined) ?? []).filter(
    (e) => now - e.deletedAt < RECYCLE_TTL_MS,
  );
}

export async function setRecycle(list: RecycleEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.recycle]: list });
}

export async function getUploadedHash(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.uploadedHash);
  return (stored[STORAGE_KEYS.uploadedHash] as string | undefined) ?? null;
}

export async function setUploadedHash(hash: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.uploadedHash]: hash });
}
