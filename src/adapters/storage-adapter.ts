/**
 * 存储适配层接口：同步引擎只依赖这五个方法，
 * 未来接 OneDrive / 其它 WebDAV 服务时，只需新增一个实现类。
 */

export interface StoredObject {
  name: string;
  lastModified: string | null;
  size: number;
}

export interface StorageAdapter {
  /** 连通性测试 */
  ping(): Promise<void>;
  /** 列目录（不存在返回空数组） */
  list(dir: string): Promise<StoredObject[]>;
  /** 读 JSON；不存在返回 null */
  readJson<T>(path: string): Promise<T | null>;
  /** 写 JSON（内部负责压缩/编码） */
  writeJson(path: string, value: unknown): Promise<void>;
  /** 删除 */
  remove(path: string): Promise<boolean>;
  /** 建目录 */
  ensureDir(dir: string): Promise<void>;
  /** 剩余请求预算，用于 UI 提示与自动降频 */
  remainingBudget(): number;
  readonly directory: string;
}
