import { describe, expect, it } from 'vitest';
import { createStorageAdapter } from '../src/adapters/factory';
import { JianguoyunAdapter } from '../src/adapters/jianguoyun';
import { Pan123Adapter } from '../src/adapters/pan123';
import { WebDavAdapter } from '../src/adapters/webdav-adapter';
import type { UdasynConfig } from '../src/shared/types';

function cfg(overrides: Partial<UdasynConfig> = {}): UdasynConfig {
  return {
    provider: 'jianguoyun',
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    account: 'jgy-user',
    appPassword: 'jgy-pass',
    webdavUrl: '',
    webdavAccount: '',
    webdavPassword: '',
    pan123Account: '',
    pan123Password: '',
    dir: 'UDaSync',
    oneDriveClientId: 'client-id',
    oneDriveAccount: '',
    oneDriveDir: 'UDaSync',
    deviceId: 'device-1',
    deviceName: 'Chrome@Mac',
    paused: false,
    firstRunDone: false,
    connectedAt: null,
    ...overrides,
  };
}

describe('provider factory', () => {
  it('坚果云仍然使用原来的 JianguoyunAdapter', () => {
    const adapter = createStorageAdapter({ cfg: cfg(), oneDriveTokens: null });
    expect(adapter).toBeInstanceOf(JianguoyunAdapter);
    expect(adapter.directory).toBe('UDaSync');
  });

  it('通用 WebDAV 使用独立的地址与凭证，不读取坚果云字段', () => {
    const adapter = createStorageAdapter({
      cfg: cfg({
        provider: 'webdav',
        // 故意保留坚果云字段，确认通用 WebDAV 不会误用
        baseUrl: 'https://dav.jianguoyun.com/dav/',
        account: 'jgy-user',
        appPassword: 'jgy-pass',
        webdavUrl: 'https://webdav.123pan.cn/webdav',
        webdavAccount: 'wd-user',
        webdavPassword: 'wd-pass',
      }),
      oneDriveTokens: null,
    });
    expect(adapter).toBeInstanceOf(WebDavAdapter);
    expect(adapter.directory).toBe('UDaSync');
  });

  it('123 云盘使用固定 WebDAV 地址和自己的独立凭证，不读取其他方案字段', () => {
    const adapter = createStorageAdapter({
      cfg: cfg({
        provider: 'pan123',
        // 故意保留坚果云与通用 WebDAV 字段，确认 123 不会误用
        baseUrl: 'https://dav.jianguoyun.com/dav/',
        account: 'jgy-user',
        appPassword: 'jgy-pass',
        webdavUrl: 'https://wd.example.com/dav/',
        webdavAccount: 'wd-user',
        webdavPassword: 'wd-pass',
        pan123Account: 'p123-user',
        pan123Password: 'p123-pass',
      }),
      oneDriveTokens: null,
    });
    expect(adapter).toBeInstanceOf(Pan123Adapter);
    expect((adapter as Pan123Adapter).endpoint).toBe('https://webdav.123pan.cn/webdav');
    expect(adapter.directory).toBe('UDaSync');
  });
});
