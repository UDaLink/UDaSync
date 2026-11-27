import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, DEFAULT_REMOTE_DIR, STORAGE_KEYS } from '../src/shared/constants';
import { clearCredentials, getConfig, hasCredentials, saveConfig } from '../src/platform/settings';
import type { UdasynConfig } from '../src/shared/types';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  (globalThis as unknown as {
    chrome: {
      storage: {
        local: {
          get: (key: string) => Promise<Record<string, unknown>>;
          set: (patch: Record<string, unknown>) => Promise<void>;
          remove: (key: string) => Promise<void>;
        };
      };
    };
  }).chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (patch) => {
          Object.assign(store, patch);
        },
        remove: async (key) => {
          delete store[key];
        },
      },
    },
  };
});

function webdavConfig(overrides: Partial<UdasynConfig> = {}): UdasynConfig {
  return {
    provider: 'webdav',
    baseUrl: DEFAULT_BASE_URL,
    account: 'jgy-user',
    appPassword: 'jgy-pass',
    webdavUrl: 'https://wd.example.com/dav/',
    webdavAccount: 'wd-user',
    webdavPassword: 'wd-pass',
    pan123Account: 'p123-user',
    pan123Password: 'p123-pass',
    dir: DEFAULT_REMOTE_DIR,
    oneDriveClientId: 'client-id',
    oneDriveAccount: 'od-user',
    oneDriveDir: DEFAULT_REMOTE_DIR,
    deviceId: 'device-1',
    deviceName: 'Chrome@Mac',
    paused: false,
    firstRunDone: true,
    connectedAt: 1,
    ...overrides,
  };
}

describe('settings provider isolation', () => {
  it('保留 webdav provider，不被归一化成坚果云', async () => {
    store[STORAGE_KEYS.config] = webdavConfig();
    const cfg = await getConfig();
    expect(cfg.provider).toBe('webdav');
    expect(cfg.webdavUrl).toBe('https://wd.example.com/dav/');
    expect(await hasCredentials(cfg)).toBe(true);
  });

  it('清除通用 WebDAV 凭证时保留坚果云与 OneDrive 字段', async () => {
    store[STORAGE_KEYS.config] = webdavConfig();
    await clearCredentials('webdav');
    const cfg = await getConfig();
    expect(cfg.webdavUrl).toBe('https://wd.example.com/dav/');
    expect(cfg.webdavAccount).toBe('');
    expect(cfg.webdavPassword).toBe('');
    expect(cfg.connectedAt).toBeNull();
    expect(cfg.account).toBe('jgy-user');
    expect(cfg.appPassword).toBe('jgy-pass');
    expect(cfg.oneDriveAccount).toBe('od-user');
    expect(await hasCredentials(cfg)).toBe(false);
  });

  it('保存通用 WebDAV 不清空原有 provider 字段', async () => {
    store[STORAGE_KEYS.config] = webdavConfig({ provider: 'jianguoyun' });
    const cfg = await saveConfig({
      provider: 'webdav',
      webdavUrl: 'https://new.example.com/dav/',
      webdavAccount: 'new-user',
      webdavPassword: 'new-pass',
      dir: DEFAULT_REMOTE_DIR,
    });
    expect(cfg.provider).toBe('webdav');
    expect(cfg.webdavUrl).toBe('https://new.example.com/dav/');
    expect(cfg.account).toBe('jgy-user');
    expect(cfg.appPassword).toBe('jgy-pass');
    expect(cfg.oneDriveAccount).toBe('od-user');
  });

  it('保留 pan123 provider，不被归一化成坚果云', async () => {
    store[STORAGE_KEYS.config] = webdavConfig({ provider: 'pan123' });
    const cfg = await getConfig();
    expect(cfg.provider).toBe('pan123');
    expect(cfg.pan123Account).toBe('p123-user');
    expect(await hasCredentials(cfg)).toBe(true);
  });

  it('清除 123 云盘凭证时保留坚果云、通用 WebDAV 与 OneDrive 字段', async () => {
    store[STORAGE_KEYS.config] = webdavConfig({ provider: 'pan123' });
    await clearCredentials('pan123');
    const cfg = await getConfig();
    expect(cfg.pan123Account).toBe('');
    expect(cfg.pan123Password).toBe('');
    expect(cfg.connectedAt).toBeNull();
    expect(cfg.account).toBe('jgy-user');
    expect(cfg.appPassword).toBe('jgy-pass');
    expect(cfg.webdavUrl).toBe('https://wd.example.com/dav/');
    expect(cfg.webdavAccount).toBe('wd-user');
    expect(cfg.oneDriveAccount).toBe('od-user');
    expect(await hasCredentials(cfg)).toBe(false);
  });

  it('保存 123 云盘不清空其他三套方案的字段', async () => {
    store[STORAGE_KEYS.config] = webdavConfig({ provider: 'jianguoyun' });
    const cfg = await saveConfig({
      provider: 'pan123',
      pan123Account: 'new-p123',
      pan123Password: 'new-p123-pass',
      dir: DEFAULT_REMOTE_DIR,
    });
    expect(cfg.provider).toBe('pan123');
    expect(cfg.pan123Account).toBe('new-p123');
    expect(cfg.account).toBe('jgy-user');
    expect(cfg.appPassword).toBe('jgy-pass');
    expect(cfg.webdavUrl).toBe('https://wd.example.com/dav/');
    expect(cfg.webdavAccount).toBe('wd-user');
    expect(cfg.webdavPassword).toBe('wd-pass');
    expect(cfg.oneDriveAccount).toBe('od-user');
  });
});
