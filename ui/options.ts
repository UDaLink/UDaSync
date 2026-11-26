import { escapeHtml, fmtRelative, fmtTime, sendMessage } from './common';

interface StateReply {
  config: {
    baseUrl: string;
    account: string;
    dir: string;
    deviceId: string;
    deviceName: string;
    paused: boolean;
    firstRunDone: boolean;
    connectedAt: number | null;
    hasCredentials: boolean;
  };
  stats: {
    lastSyncAt: number | null;
    lastStatus: string;
    lastError: string | null;
    lastCounts: { created: number; updated: number; moved: number; deleted: number };
    devices: Array<{ id: string; name: string; lastSyncAt: number; nodes: number }>;
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

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let state: StateReply | null = null;

function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  const el = $('connMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = kind === 'error' ? 'var(--danger)' : 'var(--text-sub)';
}

// ---------- 导航 ----------
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.nav'))) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    void refreshTab(btn.dataset.tab ?? 'connect');
  });
}

async function refreshTab(tab: string) {
  if (tab === 'devices') await loadDevices();
  if (tab === 'backups') await loadBackups();
  if (tab === 'recycle') await loadRecycle();
  if (tab === 'logs') await loadLogs();
  if (tab === 'connect' || tab === 'sync') await loadState();
}

// ---------- 状态 ----------
async function loadState() {
  const res = await sendMessage<StateReply>({ type: 'GET_STATE' });
  if (!res.ok || !res.data) return;
  state = res.data;
  const cfg = state.config;
  const stats = state.stats;

  $<HTMLInputElement>('baseUrl').value = cfg.baseUrl;
  $<HTMLInputElement>('account').value = cfg.account;
  $<HTMLInputElement>('account').placeholder = cfg.account || 'you@example.com';
  $<HTMLInputElement>('appPassword').placeholder = cfg.hasCredentials ? '已保存，如需更换请输入新密码' : '坚果云后台生成的应用密码';
  $('deviceName').value = cfg.deviceName;
  $('dirPath').textContent = `/${cfg.dir}/`;

  $('connDot').className = `dot ${cfg.hasCredentials ? 'ok' : ''}`;
  $('connText').textContent = cfg.hasCredentials
    ? `已连接 ${cfg.account} · 上次验证 ${fmtRelative(cfg.connectedAt)}`
    : '未连接';

  const statusMap: Record<string, string> = {
    idle: '就绪',
    ok: '正常',
    error: '同步失败',
    preview: '待确认首次合并',
    syncing: '同步中',
  };
  $('syncStatus').textContent = state.syncing ? '同步中…' : (statusMap[stats.lastStatus] ?? stats.lastStatus);
  $('syncLast').textContent = stats.lastSyncAt ? `${fmtRelative(stats.lastSyncAt)}（${fmtTime(stats.lastSyncAt)}）` : '尚未同步';
  const c = stats.lastCounts;
  $('syncCounts').textContent = `新建 ${c.created} · 更新 ${c.updated} · 移动 ${c.moved} · 删除 ${c.deleted}`;
  $('syncDevices').textContent = `${stats.devices.length} 台`;

  const err = $('syncError');
  if (stats.lastStatus === 'error' && stats.lastError) {
    err.textContent = stats.lastError;
    err.classList.remove('hidden');
  } else err.classList.add('hidden');

  $('pauseBtn').textContent = cfg.paused ? '恢复同步' : '暂停同步';
  $('syncNowBtn').disabled = state.syncing || !cfg.hasCredentials;

  if (stats.pendingPreview) renderPreview(stats.pendingPreview);
  else $('previewPanel').classList.add('hidden');
}

function renderPreview(p: NonNullable<StateReply['stats']['pendingPreview']>) {
  $('previewPanel').classList.remove('hidden');
  const list = $('previewList');
  list.innerHTML = [
    `<div class="row"><span>新增</span><strong>${p.create} 项</strong></div>`,
    `<div class="row"><span>更新标题/网址</span><strong>${p.update} 项</strong></div>`,
    `<div class="row"><span>移动/排序</span><strong>${p.move + p.reorder} 项</strong></div>`,
    `<div class="row"><span>删除</span><strong>${p.remove} 项</strong></div>`,
    p.samples.create.length
      ? `<div class="note">示例：${p.samples.create.slice(0, 5).map(escapeHtml).join('、')}</div>`
      : '',
  ].join('');
}

// ---------- 连接 ----------
$('testBtn').addEventListener('click', async () => {
  const baseUrl = $<HTMLInputElement>('baseUrl').value.trim();
  const account = $<HTMLInputElement>('account').value.trim();
  const appPassword = $<HTMLInputElement>('appPassword').value.trim();
  $('testBtn').disabled = true;
  toast('正在测试连接…');
  const res = await sendMessage<{ entries: string[] }>({ type: 'TEST_CONNECTION', baseUrl, account, appPassword });
  $('testBtn').disabled = false;
  if (res.ok) toast(`连接成功，根目录可见 ${res.data?.entries.length ?? 0} 个条目`, 'ok');
  else toast(`连接失败：${res.error ?? '未知错误'}`, 'error');
});

$('saveBtn').addEventListener('click', async () => {
  const baseUrl = $<HTMLInputElement>('baseUrl').value.trim();
  const account = $<HTMLInputElement>('account').value.trim();
  const appPassword = $<HTMLInputElement>('appPassword').value.trim();
  $('saveBtn').disabled = true;
  toast('正在保存并执行首次同步…');
  const res = await sendMessage<{ ok: boolean; needsConfirm?: boolean; summary?: NonNullable<StateReply['stats']['pendingPreview']>; error?: string }>({
    type: 'SAVE_CONFIG',
    baseUrl,
    account,
    appPassword,
  });
  $('saveBtn').disabled = false;
  if (!res.ok) {
    toast(`保存失败：${res.error ?? '未知错误'}`, 'error');
    return;
  }
  toast('已连接。');
  await loadState();
  if (res.data?.needsConfirm && res.data.summary) {
    renderPreview(res.data.summary);
    toast('云端已有其他设备的书签，请在上方预览后确认合并。');
  }
});

$('disconnectBtn').addEventListener('click', async () => {
  if (!confirm('断开后将清除本机的坚果云凭证（云端数据不会删除）。继续？')) return;
  await sendMessage({ type: 'DISCONNECT' });
  await loadState();
  toast('已断开并清除本机凭证。');
});

// ---------- 同步 ----------
$('syncNowBtn').addEventListener('click', async () => {
  $('syncNowBtn').disabled = true;
  const res = await sendMessage<{ needsConfirm?: boolean; summary?: NonNullable<StateReply['stats']['pendingPreview']>; error?: string }>({
    type: 'SYNC_NOW',
  });
  $('syncNowBtn').disabled = false;
  if (!res.ok) {
    toast(`同步失败：${res.error ?? '未知错误'}`, 'error');
  } else if (res.data?.needsConfirm && res.data.summary) {
    renderPreview(res.data.summary);
  }
  await loadState();
});

$('confirmFirstBtn').addEventListener('click', async () => {
  $('confirmFirstBtn').disabled = true;
  const res = await sendMessage<{ ok: boolean; error?: string }>({ type: 'CONFIRM_FIRST_SYNC' });
  $('confirmFirstBtn').disabled = false;
  if (!res.ok) {
    alert(`合并失败：${res.error ?? '未知错误'}`);
  } else {
    $('previewPanel').classList.add('hidden');
  }
  await loadState();
});

$('dismissPreviewBtn').addEventListener('click', () => {
  $('previewPanel').classList.add('hidden');
});

$('pauseBtn').addEventListener('click', async () => {
  const paused = !state?.config.paused;
  await sendMessage({ type: 'SET_PAUSED', paused });
  await loadState();
});

// ---------- 设备 ----------
$('renameBtn').addEventListener('click', async () => {
  const name = $<HTMLInputElement>('deviceName').value.trim();
  const res = await sendMessage({ type: 'RENAME_DEVICE', name });
  if (res.ok) toast('设备名已保存。');
  else toast(res.error ?? '保存失败', 'error');
  await loadState();
});

$('refreshDevicesBtn').addEventListener('click', () => void loadDevices());

async function loadDevices() {
  const res = await sendMessage<StateReply>({ type: 'GET_STATE' });
  if (!res.ok || !res.data) return;
  state = res.data;
  const list = $('deviceList');
  if (!state.stats.devices.length) {
    list.innerHTML = '<div class="empty">还没有设备快照。完成一次同步后会出现。</div>';
    return;
  }
  const rows = state.stats.devices
    .map((d) => {
      const self = d.id === state!.config.deviceId;
      return `<tr>
        <td>${escapeHtml(d.name)}${self ? ' <span class="tag">本机</span>' : ''}</td>
        <td>${fmtRelative(d.lastSyncAt)}</td>
        <td>${d.nodes}</td>
        <td class="actions">${self ? '' : `<button data-device="${escapeHtml(d.id)}" class="danger">移除</button>`}</td>
      </tr>`;
    })
    .join('');
  list.innerHTML = `<table><thead><tr><th>设备</th><th>最近同步</th><th>节点</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;

  for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-device]'))) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.device!;
      if (!confirm('移除该设备的云端快照？该设备之后仍可重新同步。')) return;
      await sendMessage({ type: 'DELETE_DEVICE', deviceId: id });
      await loadDevices();
    });
  }
}

// ---------- 备份 ----------
$('refreshBackupsBtn').addEventListener('click', () => void loadBackups());

async function loadBackups() {
  const res = await sendMessage<{ backups: Array<{ name: string; lastModified: string | null; size: number }> }>({
    type: 'LIST_BACKUPS',
  });
  const list = $('backupList');
  if (!res.ok) {
    list.innerHTML = `<div class="empty error-text">读取失败：${escapeHtml(res.error ?? '')}</div>`;
    return;
  }
  const items = res.data?.backups ?? [];
  if (!items.length) {
    list.innerHTML = '<div class="empty">还没有备份。完成一次有变更的同步后会自动生成。</div>';
    return;
  }
  list.innerHTML = `<table><thead><tr><th>备份文件</th><th>修改时间</th><th>大小</th><th></th></tr></thead><tbody>${items
    .map(
      (b) => `<tr><td class="mono">${escapeHtml(b.name)}</td><td>${escapeHtml(b.lastModified ?? '—')}</td><td>${Math.round(b.size / 1024)} KB</td><td class="actions"><button data-backup="${escapeHtml(b.name)}">恢复</button></td></tr>`,
    )
    .join('')}</tbody></table>`;

  for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-backup]'))) {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.backup!;
      if (!confirm(`将备份 ${name} 的内容并入本机书签？\n（不会删除现有书签，只做回填）`)) return;
      btn.disabled = true;
      const r = await sendMessage({ type: 'RESTORE_BACKUP', name });
      btn.disabled = false;
      alert(r.ok ? '恢复完成。' : `恢复失败：${r.error ?? ''}`);
      await loadState();
    });
  }
}

// ---------- 回收站 ----------
$('refreshRecycleBtn').addEventListener('click', () => void loadRecycle());

async function loadRecycle() {
  const res = await sendMessage<{ items: Array<{ id: string; title: string; url?: string; kind: string; deletedAt: number }> }>({
    type: 'LIST_RECYCLE',
  });
  const list = $('recycleList');
  if (!res.ok) {
    list.innerHTML = `<div class="empty error-text">读取失败：${escapeHtml(res.error ?? '')}</div>`;
    return;
  }
  const items = res.data?.items ?? [];
  if (!items.length) {
    list.innerHTML = '<div class="empty">回收站是空的。</div>';
    return;
  }
  list.innerHTML = `<table><thead><tr><th>标题</th><th>类型</th><th>删除时间</th><th></th></tr></thead><tbody>${items
    .map(
      (i) => `<tr><td>${escapeHtml(i.title)}</td><td>${i.kind === 'folder' ? '文件夹' : '书签'}</td><td>${fmtTime(i.deletedAt)}</td><td class="actions"><button data-recycle="${escapeHtml(i.id)}">恢复</button></td></tr>`,
    )
    .join('')}</tbody></table>`;

  for (const btn of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-recycle]'))) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.recycle!;
      btn.disabled = true;
      const r = await sendMessage({ type: 'RESTORE_RECYCLE', id });
      btn.disabled = false;
      if (!r.ok) alert(`恢复失败：${r.error ?? ''}`);
      await loadRecycle();
    });
  }
}

// ---------- 日志 ----------
$('refreshLogsBtn').addEventListener('click', () => void loadLogs());
$('clearLogsBtn').addEventListener('click', async () => {
  await sendMessage({ type: 'CLEAR_LOGS' });
  await loadLogs();
});

async function loadLogs() {
  const res = await sendMessage<{ logs: Array<{ t: number; level: string; msg: string; detail?: string }> }>({
    type: 'GET_LOGS',
  });
  const list = $('logList');
  if (!res.ok) {
    list.innerHTML = `<div class="empty error-text">读取失败：${escapeHtml(res.error ?? '')}</div>`;
    return;
  }
  const logs = (res.data?.logs ?? []).slice().reverse();
  if (!logs.length) {
    list.innerHTML = '<div class="empty">暂无日志。</div>';
    return;
  }
  list.innerHTML = logs
    .map(
      (l) => `<div class="logrow"><span class="muted">${fmtTime(l.t)}</span><span class="level-${l.level}">${l.level}</span><span class="msg">${escapeHtml(l.msg)}${l.detail ? `<br><span class="muted mono">${escapeHtml(l.detail)}</span>` : ''}</span></div>`,
    )
    .join('');
}

void loadState();
