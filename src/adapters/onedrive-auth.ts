/**
 * OneDrive 个人账号认证：OAuth 2.0 Device Code Flow。
 *
 * 选择设备代码流而不是 PKCE 回调，是因为“加载已解压扩展”的扩展 ID 会随目录变化，
 * 无法给每个安装实例预先登记 https://<extension-id>.chromiumapp.org/ 回调地址。
 * 设备代码流不需要 redirect URI，只需要在 Entra 应用注册里启用 public client flows。
 */

import { GRAPH_BASE, ONEDRIVE_AUTH_BASE, ONEDRIVE_SCOPE } from '../shared/constants';
import type { DeviceCodeInfo, OneDriveTokens } from '../shared/types';

export class OneDriveAuthError extends Error {
  constructor(
    message: string,
    readonly code = 'auth_error',
  ) {
    super(message);
    this.name = 'OneDriveAuthError';
  }
}

type FetchImpl = typeof fetch;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  message?: string;
  error?: string;
  error_description?: string;
}

interface GraphMe {
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
}

async function postForm(url: string, body: URLSearchParams, fetchImpl: FetchImpl): Promise<Response> {
  return await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });
}

/** 第一步：向 Microsoft 申请设备代码与用户码 */
export async function startDeviceCode(
  clientId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DeviceCodeInfo> {
  if (!clientId.trim()) throw new OneDriveAuthError('请先填写 OneDrive 的 Entra client ID', 'missing_client_id');
  const res = await postForm(
    `${ONEDRIVE_AUTH_BASE}/devicecode`,
    new URLSearchParams({ client_id: clientId.trim(), scope: ONEDRIVE_SCOPE }),
    fetchImpl,
  );
  const body = (await res.json()) as DeviceCodeResponse;
  if (!res.ok || !body.device_code || !body.user_code) {
    throw new OneDriveAuthError(body.error_description ?? body.error ?? '无法获取 OneDrive 登录代码', body.error ?? 'device_code_failed');
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri ?? 'https://microsoft.com/devicelogin',
    expiresIn: body.expires_in ?? 900,
    interval: body.interval ?? 5,
    message: body.message,
  };
}

/** 从 Graph /me 取一个用于界面显示的账号标识 */
export async function fetchOneDriveAccount(accessToken: string, fetchImpl: FetchImpl = fetch): Promise<string> {
  try {
    const res = await fetchImpl(`${GRAPH_BASE}/me?$select=userPrincipalName,mail,displayName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return 'OneDrive';
    const me = (await res.json()) as GraphMe;
    return me.userPrincipalName ?? me.mail ?? me.displayName ?? 'OneDrive';
  } catch {
    return 'OneDrive';
  }
}

/** 第二步：轮询 token 端点，直到用户完成授权 */
export async function pollDeviceCode(
  clientId: string,
  deviceCode: string,
  fetchImpl: FetchImpl = fetch,
): Promise<
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'ok'; tokens: OneDriveTokens }
> {
  const res = await postForm(
    `${ONEDRIVE_AUTH_BASE}/token`,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    }),
    fetchImpl,
  );
  const body = (await res.json()) as TokenResponse;

  if (res.ok && body.access_token && body.refresh_token) {
    const account = await fetchOneDriveAccount(body.access_token, fetchImpl);
    return {
      status: 'ok',
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
        scope: body.scope ?? ONEDRIVE_SCOPE,
        tokenType: body.token_type ?? 'Bearer',
        account,
      },
    };
  }

  if (body.error === 'authorization_pending') return { status: 'pending' };
  if (body.error === 'slow_down') return { status: 'slow_down', interval: 10 };

  throw new OneDriveAuthError(body.error_description ?? body.error ?? 'OneDrive 授权失败', body.error ?? 'authorization_failed');
}

/**
 * 持有令牌并在过期时刷新。刷新后的 token 会通过 onTokens 写回 chrome.storage.local。
 */
export class OneDriveAuth {
  private tokens: OneDriveTokens | null;

  constructor(
    private readonly opts: {
      clientId: string;
      tokens: OneDriveTokens | null;
      onTokens?: (tokens: OneDriveTokens) => void | Promise<void>;
      fetchImpl?: FetchImpl;
    },
  ) {
    this.tokens = opts.tokens;
  }

  async getAccessToken(force = false): Promise<string> {
    if (!this.tokens?.refreshToken) throw new OneDriveAuthError('尚未连接 OneDrive', 'not_connected');
    const stillValid = this.tokens.expiresAt - 60_000 > Date.now();
    if (!force && this.tokens.accessToken && stillValid) return this.tokens.accessToken;
    return await this.refresh();
  }

  private async refresh(): Promise<string> {
    if (!this.tokens?.refreshToken) throw new OneDriveAuthError('OneDrive 登录已失效，请重新连接', 'not_connected');
    const res = await postForm(
      `${ONEDRIVE_AUTH_BASE}/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.opts.clientId,
        refresh_token: this.tokens.refreshToken,
        scope: this.tokens.scope || ONEDRIVE_SCOPE,
      }),
      this.opts.fetchImpl ?? fetch,
    );
    const body = (await res.json()) as TokenResponse;
    if (!res.ok || !body.access_token) {
      throw new OneDriveAuthError(
        body.error_description ?? body.error ?? `OneDrive token 刷新失败 (${res.status})`,
        body.error ?? `http_${res.status}`,
      );
    }
    const next: OneDriveTokens = {
      accessToken: body.access_token,
      // Microsoft 可能不返回新的 refresh token，此时沿用旧的。
      refreshToken: body.refresh_token ?? this.tokens.refreshToken,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope ?? this.tokens.scope,
      tokenType: body.token_type ?? this.tokens.tokenType,
      account: this.tokens.account,
    };
    this.tokens = next;
    await this.opts.onTokens?.(next);
    return next.accessToken;
  }
}
