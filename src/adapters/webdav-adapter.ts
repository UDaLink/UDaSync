/**
 * 通用 WebDAV 适配器：复用 JianguoyunAdapter 的目录与 gzip 逻辑，但使用独立的
 * `webdavUrl` / `webdavAccount` / `webdavPassword` 配置。
 *
 * 单独建类而不是改 JianguoyunAdapter，确保坚果云方案的行为完全不变。
 */
import { JianguoyunAdapter } from './jianguoyun';

export class WebDavAdapter extends JianguoyunAdapter {}
