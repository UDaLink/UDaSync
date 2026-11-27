import { describe, expect, it } from 'vitest';
import { OneDriveAdapter, encodeGraphPath, oneDriveItemUrl } from '../src/adapters/onedrive';
import { OneDriveAuth, pollDeviceCode, startDeviceCode } from '../src/adapters/onedrive-auth';
import type { OneDriveTokens } from '../src/shared/types';

const EMPTY_TOKENS: OneDriveTokens = {
  accessToken: 'old-token',
  refreshToken: 'refresh-1',
  expiresAt: 1,
  scope: 'offline_access Files.ReadWrite.AppFolder User.Read',
  tokenType: 'Bearer',
  account: 'me@example.com',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('OneDrive Graph path', () => {
  it('按段编码并生成 approot 路径', () => {
    expect(encodeGraphPath('UDaSync/devices/a b.json.gz')).toBe('UDaSync/devices/a%20b.json.gz');
    expect(oneDriveItemUrl('UDaSync/devices/a.json.gz')).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/UDaSync/devices/a.json.gz',
    );
    expect(oneDriveItemUrl('')).toBe('https://graph.microsoft.com/v1.0/me/drive/special/approot');
  });
});

describe('OneDriveAdapter', () => {
  it('list 把 Graph 的 value 映射成 StoredObject，404 返回空数组', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/children')) {
        return jsonResponse({
          value: [
            { name: 'a.json.gz', size: 12, lastModifiedDateTime: '2026-11-26T10:00:00Z' },
            { name: 'nested', folder: {} },
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const adapter = new OneDriveAdapter({
      dir: 'UDaSync',
      getAccessToken: async () => 'token',
      fetchImpl,
    });
    const list = await adapter.list('devices');
    expect(list[0]).toEqual({
      name: 'a.json.gz',
      size: 12,
      lastModified: '2026-11-26T10:00:00Z',
    });
    expect(list[1]!.name).toBe('nested');
  });

  it('writeJson/readJson 往返 gzip 内容', async () => {
    const files = new Map<string, Uint8Array>();
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url.includes('/content')) {
        if (init.method === 'PUT') {
          const blob = init.body as Blob;
          files.set(url, new Uint8Array(await blob.arrayBuffer()));
          return new Response(null, { status: 201 });
        }
        const stored = files.get(url);
        return stored ? new Response(stored as BlobPart) : new Response(null, { status: 404 });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const adapter = new OneDriveAdapter({
      dir: 'UDaSync',
      getAccessToken: async () => 'token',
      fetchImpl,
    });
    const payload = { schema: 1, nodes: [{ id: 'a', title: '示例' }] };
    await adapter.writeJson('devices/a.json.gz', payload);
    expect(await adapter.readJson('devices/a.json.gz')).toEqual(payload);
    expect(calls.some((c) => c.includes('/UDaSync/devices/a.json.gz:/content'))).toBe(true);
  });

  it('401 时强制刷新 token 并重试一次', async () => {
    let token = 'bad';
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const auth = new Headers(init.headers).get('Authorization');
      if (auth === 'Bearer bad') return new Response(null, { status: 401 });
      return jsonResponse({});
    }) as typeof fetch;

    const adapter = new OneDriveAdapter({
      dir: 'UDaSync',
      getAccessToken: async (force = false) => {
        if (force) token = 'good';
        return token;
      },
      fetchImpl,
    });
    await adapter.ping();
  });
});

describe('OneDriveAuth', () => {
  it('过期后使用 refresh_token 刷新并写回', async () => {
    const onTokens: OneDriveTokens[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = String(init.body ?? '');
      expect(body).toContain('grant_type=refresh_token');
      return jsonResponse({
        access_token: 'new-token',
        refresh_token: 'refresh-2',
        expires_in: 3600,
        scope: 'offline_access Files.ReadWrite.AppFolder User.Read',
        token_type: 'Bearer',
      });
    }) as typeof fetch;

    const auth = new OneDriveAuth({
      clientId: 'client-id',
      tokens: { ...EMPTY_TOKENS, expiresAt: 1 },
      onTokens: (t) => {
        onTokens.push(t);
      },
      fetchImpl,
    });
    expect(await auth.getAccessToken()).toBe('new-token');
    expect(onTokens[0]!.refreshToken).toBe('refresh-2');
  });

  it('没有 refresh_token 时拒绝', async () => {
    const auth = new OneDriveAuth({ clientId: 'client-id', tokens: null });
    await expect(auth.getAccessToken()).rejects.toThrow('尚未连接 OneDrive');
  });
});

describe('OneDrive device code', () => {
  it('申请设备代码并轮询到 token', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/devicecode')) {
        return jsonResponse({
          device_code: 'device-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.endsWith('/token')) {
        return jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'offline_access Files.ReadWrite.AppFolder User.Read',
          token_type: 'Bearer',
        });
      }
      if (url.includes('/me?')) return jsonResponse({ userPrincipalName: 'me@example.com' });
      return jsonResponse({});
    }) as typeof fetch;

    const info = await startDeviceCode('client-id', fetchImpl);
    expect(info.userCode).toBe('ABCD-EFGH');
    const result = await pollDeviceCode('client-id', info.deviceCode, fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.tokens.refreshToken).toBe('refresh-1');
      expect(result.tokens.account).toBe('me@example.com');
    }
  });
});
