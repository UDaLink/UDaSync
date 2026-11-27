import { escapeHtml, fmtRelative, fmtTime, sendMessage } from './common';
import { PAN123_WEBDAV_URL } from '../src/shared/constants';

interface StateReply {
  config: {
    provider: 'jianguoyun' | 'webdav' | 'pan123' | 'onedrive';
    baseUrl: string;
    account: string;
    webdavUrl: string;
    webdavAccount: string;
    pan123Account: string;
    dir: string;
    oneDriveClientId: string;
    oneDriveAccount: string;
    oneDriveDir: string;
    deviceId: string;
    deviceName: string;
    paused: boolean;
    firstRunDone: boolean;
    connectedAt: number | null;
    hasCredentials: boolean;
    hasJianguoyunCredentials: boolean;
    hasWebdavCredentials: boolean;
    hasPan123Credentials: boolean;
    hasOneDriveCredentials: boolean;
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

interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let state: StateReply | null = null;

function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  const el = $('connMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = kind === 'error' ? 'var(--danger)' : 'var(--text-sub)';
}

function toastOd(msg: string, kind: 'ok' | 'error' = 'ok') {
  const el = $('odMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = kind === 'error' ? 'var(--danger)' : 'var(--text-sub)';
}

function toastWd(msg: string, kind: 'ok' | 'error' = 'ok') {
  const el = $('wdMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = kind === 'error' ? 'var(--danger)' : 'var(--text-sub)';
}

function toastP123(msg: string, kind: 'ok' | 'error' = 'ok') {
  const el = $('p123Msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = kind === 'error' ? 'var(--danger)' : 'var(--text-sub)';
}

function setProviderUI(provider: 'jianguoyun' | 'webdav' | 'pan123' | 'onedrive') {
  $('providerJianguoyun').classList.toggle('active', provider === 'jianguoyun');
  $('providerWebdav').classList.toggle('active', provider === 'webdav');
  $('providerPan123').classList.toggle('active', provider === 'pan123');
  $('providerOneDrive').classList.toggle('active', provider === 'onedrive');
  $('jianguoyunPanel').classList.toggle('hidden', provider !== 'jianguoyun');
  $('webdavPanel').classList.toggle('hidden', provider !== 'webdav');
  $('pan123Panel').classList.toggle('hidden', provider !== 'pan123');
  $('oneDrivePanel').classList.toggle('hidden', provider !== 'onedrive');
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

  setProviderUI(cfg.provider);
  $<HTMLInputElement>('baseUrl').value = cfg.baseUrl;
  $<HTMLInputElement>('account').value = cfg.account;
  $<HTMLInputElement>('account').placeholder = cfg.account || 'you@example.com';
  $<HTMLInputElement>('appPassword').placeholder = cfg.hasJianguoyunCredentials
    ? '已保存，如需更换请输入新密码'
    : '坚果云后台生成的应用密码';
  $<HTMLInputElement>('webdavUrl').value = cfg.webdavUrl;
  $<HTMLInputElement>('webdavAccount').value = cfg.webdavAccount;
  $<HTMLInputElement>('webdavPassword').placeholder = cfg.hasWebdavCredentials
    ? '已保存，如需更换请输入新密码'
    : '服务商生成的应用密码';
  $<HTMLInputElement>('pan123Url').value = PAN123_WEBDAV_URL;
  $<HTMLInputElement>('pan123Account').value = cfg.pan123Account;
  $<HTMLInputElement>('pan123Password').placeholder = cfg.hasPan123Credentials
    ? '已保存，如需更换请输入新密码'
    : '第三方挂载生成的应用密码';
  $<HTMLInputElement>('oneDriveClientId').value = cfg.oneDriveClientId;
  $('odDirPath').textContent = `/${cfg.oneDriveDir}/`;
  $('wdDirPath').textContent = `/${cfg.dir}/`;
  $('p123DirPath').textContent = `/${cfg.dir}/`;
  $('deviceName').value = cfg.deviceName;
  $('dirPath').textContent = `/${cfg.dir}/`;

  $('connDot').className = `dot ${cfg.hasJianguoyunCredentials ? 'ok' : ''}`;
  $('connText').textContent = cfg.hasJianguoyunCredentials
    ? `已连接 ${cfg.account}`
    : '未连接';

  $('wdDot').className = `dot ${cfg.hasWebdavCredentials ? 'ok' : ''}`;
  $('wdText').textContent = cfg.hasWebdavCredentials
    ? `已连接 ${cfg.webdavAccount || 'WebDAV'}`
    : '未连接';

  $('p123Dot').className = `dot ${cfg.hasPan123Credentials ? 'ok' : ''}`;
  $('p123Text').textContent = cfg.hasPan123Credentials
    ? `已连接 ${cfg.pan123Account || '123 云盘'}`
    : '未连接';

  $('odDot').className = `dot ${cfg.hasOneDriveCredentials ? 'ok' : ''}`;
  $('odText').textContent = cfg.hasOneDriveCredentials
    ? `已连接 ${cfg.oneDriveAccount || 'OneDrive'}`
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

// ---------- 存储服务切换 ----------
$('providerJianguoyun').addEventListener('click', async () => {
  if (odDeviceCode) {
    stopOdPolling();
    odDeviceCode = '';
    $('odCodePanel').classList.add('hidden');
    $('odPollStatus').textContent = '';
  }
  const res = await sendMessage({ type: 'SET_PROVIDER', provider: 'jianguoyun' });
  if (!res.ok) toast(res.error ?? '切换失败', 'error');
  await loadState();
});

$('providerOneDrive').addEventListener('click', async () => {
  const res = await sendMessage({ type: 'SET_PROVIDER', provider: 'onedrive' });
  if (!res.ok) toastOd(res.error ?? '切换失败', 'error');
  await loadState();
});

$('providerWebdav').addEventListener('click', async () => {
  if (odDeviceCode) {
    stopOdPolling();
    odDeviceCode = '';
    $('odCodePanel').classList.add('hidden');
    $('odPollStatus').textContent = '';
  }
  const res = await sendMessage({ type: 'SET_PROVIDER', provider: 'webdav' });
  await loadState();
  if (!res.ok) toastWd(res.error ?? '切换失败', 'error');
});

$('providerPan123').addEventListener('click', async () => {
  if (odDeviceCode) {
    stopOdPolling();
    odDeviceCode = '';
    $('odCodePanel').classList.add('hidden');
    $('odPollStatus').textContent = '';
  }
  const res = await sendMessage({ type: 'SET_PROVIDER', provider: 'pan123' });
  await loadState();
  if (!res.ok) toastP123(res.error ?? '切换失败', 'error');
});

// ---------- OneDrive 设备代码登录 ----------
let odTimer: ReturnType<typeof setTimeout> | null = null;
let odDeviceCode = '';
let odPollGeneration = 0;

function stopOdPolling() {
  odPollGeneration += 1;
  if (odTimer) {
    clearTimeout(odTimer);
    odTimer = null;
  }
}

function scheduleOdPoll(seconds: number, generation: number) {
  if (odTimer) clearTimeout(odTimer);
  odTimer = setTimeout(() => void pollOd(generation), Math.max(3, seconds) * 1000);
}

async function pollOd(generation: number) {
  if (generation !== odPollGeneration || !odDeviceCode) return;
  const res = await sendMessage<{ status: string; interval?: number; account?: string }>({
    type: 'ONEDRIVE_POLL_AUTH',
    deviceCode: odDeviceCode,
  });
  if (generation !== odPollGeneration) return;
  if (!res.ok) {
    $('odPollStatus').textContent = `授权失败：${res.error ?? '未知错误'}`;
    toastOd(`OneDrive 授权失败：${res.error ?? '未知错误'}`, 'error');
    stopOdPolling();
    return;
  }
  const status = res.data?.status;
  if (status === 'pending') {
    $('odPollStatus').textContent = '等待你在 Microsoft 页面完成授权…';
    scheduleOdPoll(5, generation);
    return;
  }
  if (status === 'slow_down') {
    $('odPollStatus').textContent = 'Microsoft 要求放慢轮询，继续等待…';
    scheduleOdPoll(res.data?.interval ?? 10, generation);
    return;
  }
  if (status === 'ok') {
    $('odCodePanel').classList.add('hidden');
    $('odPollStatus').textContent = '';
    odDeviceCode = '';
    stopOdPolling();
    toastOd(`已连接 ${res.data?.account ?? 'OneDrive'}，正在准备首次同步…`);
    await loadState();

    const sync = await sendMessage<{ needsConfirm?: boolean; summary?: NonNullable<StateReply['stats']['pendingPreview']>; error?: string }>({
      type: 'SYNC_NOW',
    });
    if (!sync.ok) toastOd(`已连接，但同步失败：${sync.error ?? '未知错误'}`, 'error');
    else if (sync.data?.needsConfirm && sync.data.summary) {
      renderPreview(sync.data.summary);
      toastOd('云端已有其他设备，请在上方预览后确认合并。');
    } else {
      toastOd('OneDrive 已连接并完成同步。');
    }
    await loadState();
    return;
  }

  $('odPollStatus').textContent = `未知授权状态：${String(status)}`;
  stopOdPolling();
}

$('odConnectBtn').addEventListener('click', async () => {
  const clientId = $<HTMLInputElement>('oneDriveClientId').value.trim();
  if (!clientId) {
    toastOd('请先填写 Entra 应用的 client ID。', 'error');
    return;
  }
  stopOdPolling();
  odDeviceCode = '';
  $('odCodePanel').classList.add('hidden');
  $('odConnectBtn').disabled = true;
  toastOd('正在向 Microsoft 申请登录代码…');
  const res = await sendMessage<DeviceCodeStart>({ type: 'ONEDRIVE_BEGIN_AUTH', clientId });
  $('odConnectBtn').disabled = false;
  if (!res.ok || !res.data) {
    toastOd(`获取登录代码失败：${res.error ?? '未知错误'}`, 'error');
    return;
  }

  const info = res.data;
  odDeviceCode = info.deviceCode;
  $('odUserCode').textContent = info.userCode;
  $('odVerifyLink').href = info.verificationUri;
  $('odVerifyLink').textContent = info.verificationUri.replace(/^https?:\/\//, '');
  $('odCodePanel').classList.remove('hidden');
  $('odPollStatus').textContent = `代码 ${Math.round(info.expiresIn / 60)} 分钟内有效，等待授权…`;
  toastOd('已获取登录代码，请按提示在 Microsoft 页面输入。');

  const generation = odPollGeneration;
  window.open(info.verificationUri, '_blank', 'noopener');
  scheduleOdPoll(info.interval, generation);
});

$('odCopyCodeBtn').addEventListener('click', async () => {
  const code = $('odUserCode').textContent ?? '';
  try {
    await navigator.clipboard.writeText(code);
    toastOd('登录代码已复制。');
  } catch {
    toastOd('复制失败，请手动选中代码。', 'error');
  }
});

$('odDisconnectBtn').addEventListener('click', async () => {
  if (!confirm('断开 OneDrive 并清除本机令牌？云端书签不会删除。继续？')) return;
  stopOdPolling();
  odDeviceCode = '';
  await sendMessage({ type: 'ONEDRIVE_DISCONNECT' });
  await loadState();
  toastOd('已断开 OneDrive 并清除本机令牌。');
});

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

// ---------- 通用 WebDAV ----------
/**
 * 请求访问用户填写的 WebDAV 服务器。
 * 注意：chrome.permissions.request 必须在点击手势中同步发起，函数内部不要在它之前 await。
 */
async function requestWebdavPermission(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (!url.hostname || url.search || url.hash) return false;
    if (url.username || url.password) return false;
    // 不把端口写进 match pattern：Chrome 的 host permission 按 scheme + host 匹配，默认覆盖所有端口
    const origin = `${url.protocol}//${url.hostname}/*`;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

$('wdTestBtn').addEventListener('click', async () => {
  const baseUrl = $<HTMLInputElement>('webdavUrl').value.trim();
  const account = $<HTMLInputElement>('webdavAccount').value.trim();
  const appPassword = $<HTMLInputElement>('webdavPassword').value.trim();
  if (!baseUrl || !account || !appPassword) {
    toastWd('请填写完整的服务器地址、账号与应用密码。', 'error');
    return;
  }
  const granted = await requestWebdavPermission(baseUrl);
  if (!granted) {
    toastWd('需要授权访问该服务器；请在浏览器弹窗中允许，或检查地址是否为 http/https。', 'error');
    return;
  }
  $('wdTestBtn').disabled = true;
  toastWd('正在测试连接…');
  const res = await sendMessage<{ entries: string[] }>({
    type: 'WEBDAV_TEST_CONNECTION',
    baseUrl,
    account,
    appPassword,
  });
  $('wdTestBtn').disabled = false;
  if (res.ok) toastWd(`连接成功，根目录可见 ${res.data?.entries.length ?? 0} 个条目`, 'ok');
  else toastWd(`连接失败：${res.error ?? '未知错误'}`, 'error');
});

$('wdSaveBtn').addEventListener('click', async () => {
  const baseUrl = $<HTMLInputElement>('webdavUrl').value.trim();
  const account = $<HTMLInputElement>('webdavAccount').value.trim();
  const appPassword = $<HTMLInputElement>('webdavPassword').value.trim();
  if (!baseUrl || !account || !appPassword) {
    toastWd('请填写完整的服务器地址、账号与应用密码。', 'error');
    return;
  }
  const granted = await requestWebdavPermission(baseUrl);
  if (!granted) {
    toastWd('需要授权访问该服务器；请在浏览器弹窗中允许，或检查地址是否为 http/https。', 'error');
    return;
  }
  $('wdSaveBtn').disabled = true;
  toastWd('正在保存并执行首次同步…');
  const res = await sendMessage<{ needsConfirm?: boolean; summary?: NonNullable<StateReply['stats']['pendingPreview']>; error?: string }>({
    type: 'WEBDAV_SAVE_CONFIG',
    baseUrl,
    account,
    appPassword,
  });
  $('wdSaveBtn').disabled = false;
  if (!res.ok) {
    toastWd(`保存失败：${res.error ?? '未知错误'}`, 'error');
    await loadState();
    return;
  }
  toastWd('已连接。');
  await loadState();
  if (res.data?.needsConfirm && res.data.summary) {
    renderPreview(res.data.summary);
    toastWd('云端已有其他设备的书签，请在上方预览后确认合并。');
  }
});

$('wdDisconnectBtn').addEventListener('click', async () => {
  if (!confirm('断开后将清除本机的通用 WebDAV 凭证（云端数据不会删除）。继续？')) return;
  await sendMessage({ type: 'DISCONNECT' });
  await loadState();
  toastWd('已断开并清除本机凭证。');
});

// ---------- 123 云盘 ----------
$('p123TestBtn').addEventListener('click', async () => {
  const account = $<HTMLInputElement>('pan123Account').value.trim();
  const appPassword = $<HTMLInputElement>('pan123Password').value.trim();
  if (!account || !appPassword) {
    toastP123('请填写 123 云盘账号与应用密码。', 'error');
    return;
  }
  const granted = await requestWebdavPermission(PAN123_WEBDAV_URL);
  if (!granted) {
    toastP123('需要授权访问 123 云盘；请在浏览器弹窗中允许。', 'error');
    return;
  }
  $('p123TestBtn').disabled = true;
  toastP123('正在测试连接…');
  const res = await sendMessage<{ entries: string[] }>({
    type: 'PAN123_TEST_CONNECTION',
    account,
    appPassword,
  });
  $('p123TestBtn').disabled = false;
  if (res.ok) toastP123(`连接成功，根目录可见 ${res.data?.entries.length ?? 0} 个条目`, 'ok');
  else toastP123(`连接失败：${res.error ?? '未知错误'}`, 'error');
});

$('p123SaveBtn').addEventListener('click', async () => {
  const account = $<HTMLInputElement>('pan123Account').value.trim();
  const appPassword = $<HTMLInputElement>('pan123Password').value.trim();
  if (!account || !appPassword) {
    toastP123('请填写 123 云盘账号与应用密码。', 'error');
    return;
  }
  const granted = await requestWebdavPermission(PAN123_WEBDAV_URL);
  if (!granted) {
    toastP123('需要授权访问 123 云盘；请在浏览器弹窗中允许。', 'error');
    return;
  }
  $('p123SaveBtn').disabled = true;
  toastP123('正在保存并执行首次同步…');
  const res = await sendMessage<{ needsConfirm?: boolean; summary?: NonNullable<StateReply['stats']['pendingPreview']>; error?: string }>({
    type: 'PAN123_SAVE_CONFIG',
    account,
    appPassword,
  });
  $('p123SaveBtn').disabled = false;
  if (!res.ok) {
    toastP123(`保存失败：${res.error ?? '未知错误'}`, 'error');
    await loadState();
    return;
  }
  toastP123('已连接。');
  await loadState();
  if (res.data?.needsConfirm && res.data.summary) {
    renderPreview(res.data.summary);
    toastP123('云端已有其他设备的书签，请在上方预览后确认合并。');
  }
});

$('p123DisconnectBtn').addEventListener('click', async () => {
  if (!confirm('断开后将清除本机的 123 云盘凭证（云端数据不会删除）。继续？')) return;
  await sendMessage({ type: 'DISCONNECT' });
  await loadState();
  toastP123('已断开并清除本机凭证。');
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
