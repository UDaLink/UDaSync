/** UI 与 service worker 之间的消息桥：统一超时与错误折叠。 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface Reply<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function sendMessage<T = unknown>(msg: Record<string, unknown>): Promise<Reply<T>> {
  try {
    const raw = (await chrome.runtime.sendMessage(msg)) as Envelope<T> | undefined;
    if (!raw) return { ok: false, error: '后台无响应（Service Worker 可能已休眠，请重试）' };
    return { ok: raw.ok, data: raw.data, error: raw.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function fmtTime(t: number | null | undefined): string {
  if (!t) return '—';
  return new Date(t).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtRelative(t: number | null | undefined): string {
  if (!t) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
