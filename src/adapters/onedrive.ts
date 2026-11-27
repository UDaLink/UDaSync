/**
 * OneDrive 存储适配器：Microsoft Graph + 应用专属文件夹（special/approot）。
 *
 * 只访问 Files.ReadWrite.AppFolder 授权范围内的 /UDaSync/ 目录，
 * 不读取用户 OneDrive 里的其他文件。
 */

import { GRAPH_BASE, ONEDRIVE_MAX_RETRIES } from '../shared/constants';
import { gzipText, gunzipText } from './gzip';
import type { StorageAdapter, StoredObject } from './storage-adapter';

export class OneDriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'graph_error',
  ) {
    super(message);
    this.name = 'OneDriveError';
  }
}

interface GraphDriveItem {
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: unknown;
}

interface GraphListResponse {
  value?: GraphDriveItem[];
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

type FetchImpl = typeof fetch;

/** 把相对路径按 Graph 的 `/special/approot:/...` 语法编码 */
export function encodeGraphPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function oneDriveItemUrl(fullPath: string): string {
  const clean = fullPath.replace(/^\/+|\/+$/g, '');
  if (!clean) return `${GRAPH_BASE}/me/drive/special/approot`;
  return `${GRAPH_BASE}/me/drive/special/approot:/${encodeGraphPath(clean)}`;
}

export interface OneDriveAdapterOptions {
  /** 应用专属文件夹下的目录名，例如 UDaSync */
  dir: string;
  getAccessToken: (force?: boolean) => Promise<string>;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  fetchImpl?: FetchImpl;
}

class GraphClient {
  private readonly fetchImpl: FetchImpl;

  constructor(
    private readonly getAccessToken: (force?: boolean) => Promise<string>,
    private readonly onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void,
    fetchImpl?: FetchImpl,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async request(path: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const res = await this.fetchImpl(path.startsWith('http') ? path : `${GRAPH_BASE}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      redirect: init.redirect ?? 'follow',
    });

    if (res.status === 401 && allowRetry) {
      await this.getAccessToken(true);
      return await this.request(path, init, false);
    }

    if (res.status === 429 && allowRetry) {
      const wait = Math.min(5_000, Math.max(500, Number(res.headers.get('Retry-After') ?? 1) * 1000));
      this.onLog?.('warn', `OneDrive 限流，${wait}ms 后重试`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return await this.request(path, init, false);
    }

    if (res.status >= 500 && allowRetry && ONEDRIVE_MAX_RETRIES > 0) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return await this.request(path, init, false);
    }

    return res;
  }
}

async function ensureOk(res: Response, action: string): Promise<Response> {
  if (res.ok || res.status === 201 || res.status === 204) return res;
  let code = `http_${res.status}`;
  let detail = '';
  try {
    const body = (await res.json()) as GraphErrorBody;
    code = body.error?.code ?? code;
    detail = body.error?.message ?? '';
  } catch {
    /* 非 JSON 错误体 */
  }
  throw new OneDriveError(`${action}失败 (${res.status})${detail ? `：${detail}` : ''}`, res.status, code);
}

export class OneDriveAdapter implements StorageAdapter {
  readonly directory: string;
  private readonly client: GraphClient;

  constructor(opts: OneDriveAdapterOptions) {
    this.directory = opts.dir.replace(/^\/+|\/+$/g, '') || 'UDaSync';
    this.client = new GraphClient(opts.getAccessToken, opts.onLog, opts.fetchImpl);
  }

  private fullPath(rel = ''): string {
    return `${this.directory}/${rel}`.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  }

  private itemUrl(rel = ''): string {
    return oneDriveItemUrl(this.fullPath(rel));
  }

  private childrenUrl(parentFullPath = ''): string {
    const clean = parentFullPath.replace(/^\/+|\/+$/g, '');
    if (!clean) return `${GRAPH_BASE}/me/drive/special/approot/children`;
    return `${oneDriveItemUrl(clean)}:/children`;
  }

  private contentUrl(rel: string): string {
    return `${this.itemUrl(rel)}:/content`;
  }

  async ping(): Promise<void> {
    const res = await this.client.request('/me?$select=userPrincipalName,mail,displayName');
    await ensureOk(res, 'OneDrive 连接');
  }

  async ensureDir(dir: string): Promise<void> {
    const parts = this.fullPath(dir).split('/').filter(Boolean);
    let parent = '';
    for (const part of parts) {
      let res = await this.client.request(this.childrenUrl(parent), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: part,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      });
      // 应用专属文件夹尚未初始化时，先访问一次 approot 让 Graph 创建它。
      if (res.status === 404 && parent === '') {
        await this.client.request(oneDriveItemUrl(''));
        res = await this.client.request(this.childrenUrl(parent), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: part,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        });
      }
      if (res.status === 409) {
        parent = parent ? `${parent}/${part}` : part;
        continue;
      }
      await ensureOk(res, '创建 OneDrive 目录');
      parent = parent ? `${parent}/${part}` : part;
    }
  }

  async list(dir: string): Promise<StoredObject[]> {
    const res = await this.client.request(this.childrenUrl(this.fullPath(dir)));
    if (res.status === 404) return [];
    await ensureOk(res, '读取 OneDrive 目录');
    const body = (await res.json()) as GraphListResponse;
    return (body.value ?? []).map((item) => ({
      name: item.name ?? '',
      lastModified: item.lastModifiedDateTime ?? null,
      size: item.size ?? 0,
    }));
  }

  async readJson<T>(path: string): Promise<T | null> {
    const res = await this.client.request(this.contentUrl(path));
    if (res.status === 404) return null;
    await ensureOk(res, '读取 OneDrive 文件');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = await gunzipText(bytes);
    return JSON.parse(text) as T;
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    const payload = await gzipText(JSON.stringify(value));
    const put = async () =>
      await this.client.request(this.contentUrl(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/gzip' },
        body: new Blob([payload as unknown as BlobPart], { type: 'application/gzip' }),
      });

    let res = await put();
    if (res.status === 404) {
      const parent = path.replace(/\/[^/]+\/?$/, '');
      await this.ensureDir(parent);
      res = await put();
    }
    await ensureOk(res, '写入 OneDrive 文件');
  }

  async remove(path: string): Promise<boolean> {
    const res = await this.client.request(this.itemUrl(path), { method: 'DELETE' });
    if (res.status === 404) return false;
    await ensureOk(res, '删除 OneDrive 文件');
    return true;
  }

  remainingBudget(): number {
    // Graph 通过 429 + Retry-After 表达限流，这里不做客户端预算截断。
    return Number.MAX_SAFE_INTEGER;
  }
}
