/** 领域模型：所有模块共享的类型定义。 */

export type NodeKind = 'folder' | 'bookmark';

/**
 * 同步模型中的一个节点。
 * id 是扩展自己生成的 UUID，与 Chrome 的书签 id 无关，保证跨设备可对齐。
 */
export interface BookmarkNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  title: string;
  url?: string;
  /** 在父节点中的位置（0 起）。合并后会被规范化为连续序号 */
  index: number;
  createdAt: number;
  updatedAt: number;
  /** 非空表示墓碑（已删除），值即删除时间 */
  deletedAt?: number;
  /** 合并去重时被并入本节点的其它 id；用于兼容各设备历史 id */
  aliases?: string[];
}

export interface Snapshot {
  schema: number;
  deviceId: string;
  deviceName: string;
  generatedAt: number;
  nodes: BookmarkNode[];
}

/** 当前使用的云端存储服务 */
export type StorageProvider = 'jianguoyun' | 'onedrive';

/** OneDrive OAuth 令牌（只保存在本机 chrome.storage.local） */
export interface OneDriveTokens {
  accessToken: string;
  refreshToken: string;
  /** 毫秒时间戳 */
  expiresAt: number;
  scope: string;
  tokenType: string;
  /** 登录后从 /me 取得的账号标识，仅用于界面显示 */
  account: string;
}

/** 设备代码登录返回给界面的信息 */
export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}

export interface UdasynConfig {
  provider: StorageProvider;
  baseUrl: string;
  account: string;
  appPassword: string;
  /** 云端目录名，固定 ASCII */
  dir: string;
  /** OneDrive 的 Entra Application (client) ID */
  oneDriveClientId: string;
  /** OneDrive 登录账号，仅用于界面显示 */
  oneDriveAccount: string;
  /** OneDrive 应用专属文件夹下的目录名，固定 ASCII */
  oneDriveDir: string;
  deviceId: string;
  deviceName: string;
  paused: boolean;
  firstRunDone: boolean;
  connectedAt: number | null;
}

export interface NodeMeta {
  createdAt: number;
  updatedAt: number;
  /** 内容指纹：标题|网址|父节点|位置|类型 */
  hash: string;
}

export interface IdMap {
  byUuid: Record<string, string>;
  byChrome: Record<string, string>;
  meta: Record<string, NodeMeta>;
}

export interface TombstoneRecord {
  deletedAt: number;
  parentId: string | null;
  title: string;
  kind: NodeKind;
  url?: string;
}

export type Tombstones = Record<string, TombstoneRecord>;

export interface RecycleEntry {
  id: string;
  kind: NodeKind;
  title: string;
  url?: string;
  parentId: string | null;
  parentTitle: string;
  deletedAt: number;
  reason: 'remote-delete' | 'overwrite' | 'local-cleanup';
}

export interface SyncCounts {
  created: number;
  updated: number;
  moved: number;
  deleted: number;
}

export type SyncStatus = 'idle' | 'ok' | 'error' | 'preview' | 'syncing';

export interface DeviceInfo {
  id: string;
  name: string;
  lastSyncAt: number;
  nodes: number;
}

export interface SyncStats {
  lastSyncAt: number | null;
  lastStatus: SyncStatus;
  lastError: string | null;
  lastReason: string | null;
  lastCounts: SyncCounts;
  consecutiveFailures: number;
  devices: DeviceInfo[];
  lastBackupAt: number | null;
  pendingPreview: PlanSummary | null;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
  detail?: string;
}

/** 与 Chrome 树解耦的最小节点结构，便于单元测试注入假数据 */
export interface TreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: TreeNode[];
}

export interface LocalItem {
  uuid: string;
  chromeId: string;
  parentUuid: string;
  kind: NodeKind;
  title: string;
  url?: string;
  index: number;
}

export interface LocalModel {
  items: LocalItem[];
  nodes: BookmarkNode[];
  /** 本次构建发现的本地删除（chromeId 已不存在） */
  removedUuids: string[];
  /** 本次构建才生成 UUID 的节点（重装后可能需要在云端“认领”旧身份） */
  freshUuids: string[];
}

export interface PlanSummary {
  create: number;
  update: number;
  move: number;
  reorder: number;
  remove: number;
  samples: { create: string[]; remove: string[] };
}

export interface SyncResult {
  ok: boolean;
  needsConfirm?: boolean;
  summary?: PlanSummary;
  counts?: SyncCounts;
  error?: string;
  at?: number;
}
