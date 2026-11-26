/**
 * 全局常量。所有「魔法数字」集中在此，便于审阅与调参。
 */

export const APP_NAME = 'UDaSync';
export const APP_VERSION = '0.1.0';
export const SCHEMA_VERSION = 1;

/** 坚果云 WebDAV 根地址（只认真实 UTF-8 路径，中文路径在浏览器里会被百分号编码，故目录名必须纯 ASCII） */
export const DEFAULT_BASE_URL = 'https://dav.jianguoyun.com/dav/';
export const DEFAULT_REMOTE_DIR = 'UDaSync';
export const REMOTE_DEVICES_DIR = 'devices';
export const REMOTE_BACKUPS_DIR = 'backups';

/** 书签变动后的合并窗口：攒 5 秒再同步一次，避免连续编辑打爆请求数 */
export const CHANGE_DEBOUNCE_MS = 5000;

export const ALARM_POLL = 'udasyn.poll';
export const ALARM_RETRY = 'udasyn.retry';
export const POLL_PERIOD_MINUTES = 10;

/** 删除墓碑在云端保留 30 天，防止离线太久的设备把已删书签复活 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 本地回收站 */
export const RECYCLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECYCLE_MAX = 300;
/** 云端备份保留份数与最小间隔 */
export const BACKUP_MAX_FILES = 10;
export const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
/** 坚果云免费版 30 分钟 600 次请求，留出余量 */
export const REQUEST_BUDGET_PER_WINDOW = 450;
export const REQUEST_WINDOW_MS = 30 * 60 * 1000;
/** 连续失败多少次后弹系统通知 */
export const FAILURE_NOTIFY_THRESHOLD = 3;
/** 应用远端变更时的静默窗口：期间忽略一切书签事件，避免自激循环 */
export const APPLY_SUPPRESS_MS = 60 * 1000;

/** 本机备份文件夹的前缀，带此前缀的子树不参与同步 */
export const LOCAL_BACKUP_PREFIX = '[本机备份]';

/** 固定根节点 UUID（跨设备一致，不参与冲突合并） */
export const ROOT_UUID = 'r:0';
export const ROOT_BAR = 'r:1';
export const ROOT_OTHER = 'r:2';
export const ROOT_MOBILE = 'r:3';
export const ROOTS: Array<{ uuid: string; chromeId: string }> = [
  { uuid: ROOT_BAR, chromeId: '1' },
  { uuid: ROOT_OTHER, chromeId: '2' },
  { uuid: ROOT_MOBILE, chromeId: '3' },
];
/** Chrome 根节点（getTree 的顶层节点）id 固定为 0，其下三个根的顺序固定 */
export const CHROME_ROOT_ID = '0';
/** 三个根按位置映射；不同 profile 的根 id 可能不是 1/2/3，必须按顺序识别 */
export const ROOT_UUIDS_BY_INDEX: string[] = [ROOT_BAR, ROOT_OTHER, ROOT_MOBILE];
export const ROOT_TITLES: Record<string, string> = {
  [ROOT_BAR]: '书签栏',
  [ROOT_OTHER]: '其他书签',
  [ROOT_MOBILE]: '移动端书签',
};
export const ROOT_UUID_BY_CHROME_ID = new Map<string, string>(
  ROOTS.map((r) => [r.chromeId, r.uuid]),
);
export const CHROME_ID_BY_ROOT_UUID = new Map<string, string>(
  ROOTS.map((r) => [r.uuid, r.chromeId]),
);

export const STORAGE_KEYS = {
  config: 'cfg',
  ids: 'ids',
  tombs: 'tomb',
  stats: 'stats',
  logs: 'logs',
  recycle: 'recycle',
  uploadedHash: 'uploadHash',
  applyLock: 'applyLock',
} as const;
