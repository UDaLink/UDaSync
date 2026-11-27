/**
 * WebDAV 客户端：坚果云与通用 WebDAV 共用。
 * 只做四件事：列目录、读文件、写文件、删文件（外加建目录）。
 * 所有请求统一走 RequestBudget，防止撞上 30 分钟 600 次的服务端限流。
 */

import { REQUEST_BUDGET_PER_WINDOW, REQUEST_WINDOW_MS } from '../shared/constants';
import { base64Utf8 } from '../core/ids';

export interface WebDavOptions {
  baseUrl: string;
  account: string;
  appPassword: string;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface DavEntry {
  name: string;
  isDir: boolean;
  size: number;
  lastModified: string | null;
}

export class WebDavError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'WebDavError';
  }
}

export class RequestBudget {
  private hits: number[] = [];

  constructor(private readonly limit = REQUEST_BUDGET_PER_WINDOW) {}

  tryConsume(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < REQUEST_WINDOW_MS);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }

  remaining(now = Date.now()): number {
    this.hits = this.hits.filter((t) => now - t < REQUEST_WINDOW_MS);
    return Math.max(0, this.limit - this.hits.length);
  }
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`;

function normalizeBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export class WebDavClient {
  private readonly base: string;
  private readonly auth: string;
  readonly budget = new RequestBudget();

  constructor(private readonly opts: WebDavOptions) {
    this.base = normalizeBase(opts.baseUrl);
    this.auth = `Basic ${base64Utf8(`${opts.account}:${opts.appPassword}`)}`;
  }

  private urlOf(path: string): string {
    const clean = path.replace(/^\/+/, '');
    return `${this.base}${clean}`;
  }

  private async request(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: BodyInit | null } = {},
  ): Promise<Response> {
    if (!this.budget.tryConsume()) {
      throw new WebDavError('请求过于频繁，已暂停（本地预算保护）', 429, path);
    }
    const headers: Record<string, string> = {
      Authorization: this.auth,
      ...(init.headers ?? {}),
    };
    const res = await fetch(this.urlOf(path), {
      method,
      headers,
      body: init.body ?? null,
      redirect: 'follow',
      // 坚果云会返回 ETag/Last-Modified，浏览器 HTTP 缓存可能让第二次同步读到旧快照
      cache: 'no-store',
    });
    if (res.status >= 400 && res.status !== 404) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      this.opts.onLog?.('warn', `WebDAV ${method} ${path} -> ${res.status} ${detail}`);
    }
    return res;
  }

  /** 列目录（Depth: 1），返回子项。目录不存在返回 404。 */
  async list(path: string): Promise<DavEntry[] | null> {
    const res = await this.request('PROPFIND', path, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return null;
    if (!res.ok && res.status !== 207) {
      throw new WebDavError(`列目录失败 (${res.status})`, res.status, path);
    }
    const xml = await res.text();
    return parseMultiStatus(xml, path);
  }

  async stat(path: string): Promise<DavEntry | null> {
    const res = await this.request('PROPFIND', path, {
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return null;
    if (!res.ok && res.status !== 207) throw new WebDavError(`探测失败 (${res.status})`, res.status, path);
    const xml = await res.text();
    const entries = parseMultiStatus(xml, path);
    return entries.find((e) => e.name !== '' && e.isDir) ?? entries[0] ?? null;
  }

  /** 读取文件；不存在返回 null */
  async get(path: string): Promise<Uint8Array | null> {
    const res = await this.request('GET', path);
    if (res.status === 404) return null;
    if (!res.ok) throw new WebDavError(`读取失败 (${res.status})`, res.status, path);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** 写文件；父目录不存在时自动创建后重试一次 */
  async put(path: string, data: Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
    let res = await this.request('PUT', path, {
      headers: { 'Content-Type': contentType },
      body: new Blob([data as unknown as BlobPart], { type: contentType }),
    });
    if (res.status === 409) {
      const parent = path.replace(/\/[^/]+\/?$/, '');
      if (parent && parent !== path) await this.mkdir(parent);
      res = await this.request('PUT', path, {
        headers: { 'Content-Type': contentType },
        body: new Blob([data as unknown as BlobPart], { type: contentType }),
      });
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new WebDavError(`写入失败 (${res.status})`, res.status, path);
    }
  }

  /** 递归建目录；已存在视为成功 */
  async mkdir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const res = await this.request('MKCOL', cur);
      if (!res.ok && res.status !== 201 && res.status !== 405 && res.status !== 301) {
        throw new WebDavError(`建目录失败 (${res.status})`, res.status, cur);
      }
    }
  }

  async delete(path: string): Promise<boolean> {
    const res = await this.request('DELETE', path);
    if (res.status === 404) return false;
    if (!res.ok && res.status !== 204) throw new WebDavError(`删除失败 (${res.status})`, res.status, path);
    return true;
  }

  /** 连通性测试：PROPFIND 根目录 */
  async ping(): Promise<{ ok: boolean; status: number; entries: DavEntry[] }> {
    const res = await this.request('PROPFIND', '', {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    });
    if (res.status === 401) throw new WebDavError('账号或应用密码不正确（401）', 401, '');
    if (!res.ok && res.status !== 207) throw new WebDavError(`连接失败 (${res.status})`, res.status, '');
    const xml = await res.text();
    return { ok: true, status: res.status, entries: parseMultiStatus(xml, '') };
  }
}

/** 极简 multistatus 解析：兼容常见 WebDAV 服务器的 d:/D:/默认命名空间，不依赖 DOM。 */
export function parseMultiStatus(xml: string, requestPath: string): DavEntry[] {
  const entries: DavEntry[] = [];
  // 允许任意 XML 前缀，也允许 <response> 使用默认命名空间
  const responses = xml.split(/<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>/i).slice(1);

  for (const chunk of responses) {
    const hrefMatch = chunk.match(/<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([^<]*)</i);
    if (!hrefMatch) continue;
    let href = hrefMatch[1]!;
    try {
      href = decodeURIComponent(href);
    } catch {
      /* 保持原样 */
    }
    const isDir =
      /<(?:[A-Za-z_][\w.-]*:)?collection\b[^>]*?\/?>/i.test(chunk) ||
      /<(?:[A-Za-z_][\w.-]*:)?resourcetype\b[^>]*>\s*<(?:[A-Za-z_][\w.-]*:)?collection\b/i.test(chunk);
    const sizeMatch = chunk.match(/<(?:[A-Za-z_][\w.-]*:)?getcontentlength\b[^>]*>(\d+)</i);
    const modMatch = chunk.match(/<(?:[A-Za-z_][\w.-]*:)?getlastmodified\b[^>]*>([^<]*)</i);

    let path = href;
    if (path.startsWith('http')) {
      try {
        path = new URL(path).pathname;
      } catch {
        /* ignore */
      }
    }
    const trimmed = path.replace(/^\/+|\/+$/g, '');
    const reqTrimmed = requestPath.replace(/^\/+|\/+$/g, '');
    // 跳过请求路径自身：href 可能带 /dav 前缀，用后缀判断
    if (reqTrimmed && (trimmed === reqTrimmed || trimmed.endsWith(`/${reqTrimmed}`))) continue;
    const name = trimmed.split('/').filter(Boolean).pop();
    if (!name) continue;
    entries.push({
      name,
      isDir,
      size: sizeMatch ? Number(sizeMatch[1]) : 0,
      lastModified: modMatch ? modMatch[1]! : null,
    });
  }
  return entries;
}
