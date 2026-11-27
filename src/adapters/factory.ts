/** 根据当前 provider 构造存储适配器；同步引擎不直接依赖某个具体实现。 */

import type { OneDriveTokens, UdasynConfig } from '../shared/types';
import { JianguoyunAdapter } from './jianguoyun';
import { OneDriveAdapter } from './onedrive';
import { OneDriveAuth } from './onedrive-auth';
import type { StorageAdapter } from './storage-adapter';

export interface AdapterOptions {
  cfg: UdasynConfig;
  oneDriveTokens: OneDriveTokens | null;
  onOneDriveTokens?: (tokens: OneDriveTokens) => void | Promise<void>;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  fetchImpl?: typeof fetch;
}

export function createStorageAdapter(opts: AdapterOptions): StorageAdapter {
  const { cfg } = opts;
  if (cfg.provider === 'onedrive') {
    const auth = new OneDriveAuth({
      clientId: cfg.oneDriveClientId,
      tokens: opts.oneDriveTokens,
      onTokens: opts.onOneDriveTokens,
      fetchImpl: opts.fetchImpl,
    });
    return new OneDriveAdapter({
      dir: cfg.oneDriveDir,
      getAccessToken: (force) => auth.getAccessToken(force),
      onLog: opts.onLog,
      fetchImpl: opts.fetchImpl,
    });
  }

  return new JianguoyunAdapter(
    cfg.baseUrl,
    cfg.account,
    cfg.appPassword,
    cfg.dir,
    opts.onLog,
  );
}
