/**
 * 坚果云实现：JSON 一律 gzip 后存储（*.json.gz），节省免费版每月 1GB 上行流量。
 * gzip 用平台自带的 CompressionStream / DecompressionStream，无第三方依赖。
 */

import { WebDavClient } from './webdav';
import type { StorageAdapter, StoredObject } from './storage-adapter';

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export class JianguoyunAdapter implements StorageAdapter {
  readonly directory: string;
  private readonly client: WebDavClient;

  constructor(
    baseUrl: string,
    account: string,
    appPassword: string,
    private readonly dir: string,
    private readonly onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {
    this.client = new WebDavClient({ baseUrl, account, appPassword, onLog });
    this.directory = dir;
  }

  private path(rel: string): string {
    return `${this.directory}/${rel}`.replace(/\/+/g, '/');
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async ensureDir(dir: string): Promise<void> {
    await this.client.mkdir(this.path(dir));
  }

  async list(dir: string): Promise<StoredObject[]> {
    const entries = await this.client.list(this.path(dir));
    if (!entries) return [];
    return entries.map((e) => ({ name: e.name, lastModified: e.lastModified, size: e.size }));
  }

  async readJson<T>(path: string): Promise<T | null> {
    const bytes = await this.client.get(this.path(path));
    if (!bytes) return null;
    const text = await gunzip(bytes);
    return JSON.parse(text) as T;
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    const payload = await gzip(JSON.stringify(value));
    await this.client.put(this.path(path), payload, 'application/gzip');
  }

  async remove(path: string): Promise<boolean> {
    return await this.client.delete(this.path(path));
  }

  remainingBudget(): number {
    return this.client.budget.remaining();
  }

  async rawGet(path: string): Promise<Uint8Array | null> {
    return await this.client.get(this.path(path));
  }
}
