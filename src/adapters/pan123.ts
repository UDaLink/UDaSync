/**
 * 123 云盘 WebDAV 适配器：固定使用官方 WebDAV 入口，只读取 123 云盘自己的
 * `pan123Account` / `pan123Password`，不碰通用 WebDAV 的配置，避免两套方案串数据。
 */
import { PAN123_WEBDAV_URL } from '../shared/constants';
import { WebDavAdapter } from './webdav-adapter';

export class Pan123Adapter extends WebDavAdapter {
  readonly endpoint = PAN123_WEBDAV_URL;

  constructor(
    account: string,
    appPassword: string,
    dir: string,
    onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {
    super(PAN123_WEBDAV_URL, account, appPassword, dir, onLog);
  }
}
