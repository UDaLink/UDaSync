/** 统一日志：写存储环形缓冲 + 控制台；所有失败都要有落点。 */

import { appendLog } from './settings';

export async function log(level: 'info' | 'warn' | 'error', msg: string, detail?: string): Promise<void> {
  const entry = { t: Date.now(), level, msg, ...(detail ? { detail } : {}) };
  if (level === 'error') console.error('[UDaSync]', msg, detail ?? '');
  else if (level === 'warn') console.warn('[UDaSync]', msg, detail ?? '');
  else console.log('[UDaSync]', msg);
  try {
    await appendLog(entry);
  } catch {
    /* 存储失败不影响主流程 */
  }
}
