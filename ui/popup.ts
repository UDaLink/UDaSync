import { sendMessage } from './common';

interface State {
  config: {
    provider: 'jianguoyun' | 'onedrive';
    account: string;
    oneDriveAccount: string;
    dir: string;
    oneDriveDir: string;
    deviceName: string;
    paused: boolean;
    firstRunDone: boolean;
    hasCredentials: boolean;
  };
  stats: {
    lastSyncAt: number | null;
    lastStatus: string;
    lastError: string | null;
    lastCounts: { created: number; updated: number; moved: number; deleted: number };
    devices: Array<{ id: string; name: string; lastSyncAt: number }>;
    pendingPreview: {
      create: number;
      update: number;
      move: number;
      reorder: number;
      remove: number;
      samples: { create: string[]; remove: string[] };
    } | null;
  };
  syncing: boolean;
}

let lastPreview: NonNullable<State['stats']['pendingPreview']> | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function fmtRelative(t: number | null): string {
  if (!t) return '尚未同步';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setDot(cls: string) {
  $('dot').className = `dot ${cls}`;
}

async function refresh() {
  const state = await sendMessage<State>({ type: 'GET_STATE' });
  if (!state?.ok) return;
  const s = state.data;
  const providerLabel = s.config.provider === 'onedrive' ? 'OneDrive' : '坚果云';
  const account = s.config.provider === 'onedrive' ? s.config.oneDriveAccount : s.config.account;
  const dir = s.config.provider === 'onedrive' ? s.config.oneDriveDir : s.config.dir;
  $('device').textContent = `${s.config.deviceName} · ${providerLabel}${account ? ` · ${account}` : ''} · ${dir}`;

  if (!s.config.hasCredentials) {
    $('bound').classList.add('hidden');
    $('unbound').classList.remove('hidden');
    setDot('');
    return;
  }
  $('unbound').classList.add('hidden');
  $('bound').classList.remove('hidden');

  const statusText = s.syncing
    ? '同步中…'
    : s.stats.lastStatus === 'error'
      ? '上次同步失败'
      : s.stats.lastStatus === 'preview'
        ? '待确认首次合并'
        : s.stats.lastStatus === 'ok'
          ? '正常'
          : '就绪';
  $('status').textContent = statusText;
  $('last').textContent = fmtRelative(s.stats.lastSyncAt);
  const c = s.stats.lastCounts;
  $('counts').textContent = `+${c.created} ~${c.updated} →${c.moved} -${c.deleted}`;
  $('devices').textContent = `${s.stats.devices.length} 台设备`;

  const err = $('error');
  if (s.stats.lastStatus === 'error' && s.stats.lastError) {
    err.textContent = s.stats.lastError;
    err.classList.remove('hidden');
    setDot('error');
  } else {
    err.classList.add('hidden');
    setDot(s.syncing ? 'syncing' : 'ok');
  }

  $('pause').textContent = s.config.paused ? '恢复同步' : '暂停同步';
  $('sync').disabled = s.syncing || s.config.paused;

  if (s.stats.pendingPreview) {
    lastPreview = s.stats.pendingPreview;
    renderPreview(lastPreview);
  }
}

function renderPreview(p: NonNullable<State['stats']['pendingPreview']>) {
  const box = $('preview');
  box.classList.remove('hidden');
  $('bound').classList.add('hidden');
  const lines: string[] = [];
  lines.push(`<div class="row"><span>将新增</span><strong>${p.create} 项</strong></div>`);
  lines.push(`<div class="row"><span>将更新</span><strong>${p.update} 项</strong></div>`);
  lines.push(`<div class="row"><span>将移动/排序</span><strong>${p.move + p.reorder} 项</strong></div>`);
  lines.push(`<div class="row"><span>将删除</span><strong>${p.remove} 项</strong></div>`);
  if (p.samples.create.length) {
    lines.push(`<p class="muted">示例：${p.samples.create.slice(0, 3).map((x) => escapeHtml(x)).join('、')}</p>`);
  }
  $('previewBody').innerHTML = lines.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

$('sync').addEventListener('click', async () => {
  $('sync').disabled = true;
  $('status').textContent = '同步中…';
  setDot('syncing');
  const res = await sendMessage<{ ok: boolean; needsConfirm?: boolean; summary?: typeof lastPreview; error?: string }>({
    type: 'SYNC_NOW',
  });
  if (res?.ok && res.data?.needsConfirm && res.data.summary) {
    lastPreview = res.data.summary;
    renderPreview(lastPreview);
    return;
  }
  await refresh();
});

$('confirm').addEventListener('click', async () => {
  $('confirm').disabled = true;
  const res = await sendMessage<{ ok: boolean; error?: string }>({ type: 'CONFIRM_FIRST_SYNC' });
  $('confirm').disabled = false;
  if (!res?.ok) {
    alert(res?.error ?? '合并失败，请到设置页查看日志');
    return;
  }
  $('preview').classList.add('hidden');
  await refresh();
});

$('cancel').addEventListener('click', async () => {
  $('preview').classList.add('hidden');
  await refresh();
});

$('pause').addEventListener('click', async () => {
  const state = await sendMessage<State>({ type: 'GET_STATE' });
  const paused = Boolean(state?.data?.config.paused);
  await sendMessage({ type: 'SET_PAUSED', paused: !paused });
  await refresh();
});

$('settings').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

$('openOptions').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void refresh();
setInterval(() => void refresh(), 2500);
