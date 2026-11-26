/**
 * 双配置 E2E：两台「假电脑」（独立 Chrome profile）通过真实坚果云同步。
 * 凭证只从环境变量读取，不落盘、不入库：
 *   JGY_ACCOUNT / JGY_PASSWORD / JGY_BASE_URL（可选）
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CdpSession, listTargets, openTab, waitForBrowser, waitUntil } from './cdp.mjs';

const CHROME =
  process.env.CHROME_BIN ??
  '/tmp/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DIST = resolve(import.meta.dirname, '../../dist');
const ACCOUNT = process.env.JGY_ACCOUNT;
const PASSWORD = process.env.JGY_PASSWORD;
const BASE_URL = process.env.JGY_BASE_URL ?? 'https://dav.jianguoyun.com/dav/';
const TEST_DIR = process.env.JGY_DIR ?? 'UDaSync-E2E';

if (!ACCOUNT || !PASSWORD) {
  console.error('缺少 JGY_ACCOUNT / JGY_PASSWORD 环境变量');
  process.exit(2);
}

const AUTH = 'Basic ' + Buffer.from(`${ACCOUNT}:${PASSWORD}`).toString('base64');

/** 坚果云不允许 DELETE 目录（403），只能逐个删除快照文件 */
async function cleanCloud() {
  const origin = new URL(BASE_URL).origin;
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`;
  let removed = 0;
  for (const sub of ['devices', 'backups']) {
    const url = `${BASE_URL.replace(/\/$/, '')}/${TEST_DIR}/${sub}/`;
    try {
      const res = await fetch(url, {
        method: 'PROPFIND',
        headers: { Authorization: AUTH, Depth: '1', 'Content-Type': 'application/xml' },
        body,
      });
      if (!res.ok && res.status !== 207) continue;
      const xml = await res.text();
      const hrefs = [...xml.matchAll(/<d:href>([^<]*)<\/d:href>/g)].map((m) => m[1]);
      for (const href of hrefs) {
        if (!href.endsWith('.json.gz')) continue;
        const target = href.startsWith('http') ? href : `${origin}${href}`;
        const del = await fetch(target, { method: 'DELETE', headers: { Authorization: AUTH } });
        if (del.ok || del.status === 404) removed++;
      }
    } catch (err) {
      console.log(`清理 ${sub} 失败：`, err.message);
    }
  }
  console.log(`已清理云端测试快照：${removed} 个文件`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function launchChrome(label, port, profileDir) {
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${DIST}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      `--remote-debugging-port=${port}`,
      '--headless=new',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'], detached: true },
  );
  child.unref();
  return child;
}

async function extensionId(port) {
  // 浏览器里可能同时有多个带 background.js 的内置扩展，必须按 manifest 名称认领
  const started = Date.now();
  while (Date.now() - started < 30000) {
    let targets = [];
    try {
      targets = await listTargets(port);
    } catch {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    for (const t of targets) {
      if (t.type !== 'service_worker' || !t.url.startsWith('chrome-extension://')) continue;
      try {
        const s = await CdpSession.connect(t.webSocketDebuggerUrl);
        await s.send('Runtime.enable');
        const name = await s.evaluate('chrome.runtime.getManifest().name');
        s.close();
        if (typeof name === 'string' && name.includes('UDaSync')) {
          return new URL(t.url).hostname;
        }
      } catch {
        /* target 可能刚好在重启 */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('没有找到已加载的 UDaSync 扩展（--load-extension 可能被浏览器忽略）');
}

async function openOptions(port, extId) {
  const tab = await openTab(port, `chrome-extension://${extId}/options.html`);
  const session = await CdpSession.connect(tab.webSocketDebuggerUrl);
  await session.send('Runtime.enable');
  return session;
}

const send = (type, extra = {}) => `chrome.runtime.sendMessage(${JSON.stringify({ type, ...extra })})`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 背景返回统一信封 {ok,data,error}，这里统一拆包 */
async function call(page, msg) {
  return await page.evaluate(`(async () => await ${send(msg.type, Object.fromEntries(Object.entries(msg).filter(([k]) => k !== 'type')))})()`);
}

const payload = (r) => r?.data ?? r;

async function syncNow(page) {
  for (let i = 0; i < 8; i++) {
    const r = await call(page, { type: 'SYNC_NOW' });
    if (r?.ok) return { ok: true, ...(payload(r) ?? {}) };
    if (String(r?.error ?? '').includes('正在进行')) {
      await sleep(1500);
      continue;
    }
    return r;
  }
  return { ok: false, error: '多次重试仍同步失败' };
}

async function logs(page) {
  const r = await call(page, { type: 'GET_LOGS' });
  return (payload(r)?.logs ?? []).slice(-10).map((l) => `${l.level}: ${l.msg}${l.detail ? ` | ${l.detail}` : ''}`).join('\n');
}

async function stateOf(page) {
  return await page.evaluate(`(async () => {
    const r = await ${send('GET_STATE')};
    return r;
  })()`);
}

async function bind(page) {
  return await page.evaluate(`(async () => {
    return await chrome.runtime.sendMessage(${JSON.stringify({
      type: 'SAVE_CONFIG',
      baseUrl: BASE_URL,
      account: ACCOUNT,
      appPassword: PASSWORD,
      dir: TEST_DIR,
    })});
  })()`);
}

async function pauseAuto(page) {
  await call(page, { type: 'SET_PAUSED', paused: true });
}

async function treeTitles(page) {
  return await page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    const out = [];
    const walk = (n) => { if (n.title) out.push(n.title); (n.children||[]).forEach(walk); };
    tree.forEach(walk);
    return out;
  })()`);
}

async function treePaths(page) {
    return await page.evaluate(`(async () => {
      const out = [];
      const walk = async (nodes, prefix) => {
        for (const n of nodes) {
          const p = prefix ? prefix + '/' + n.title : n.title;
          out.push(p + (n.url ? ' <url>' : ''));
          if (n.children) await walk(n.children, p);
        }
      };
      const tree = await chrome.bookmarks.getTree();
      await walk(tree[0].children || [], '');
      return out;
    })()`);
  }

async function addBookmark(page, parentId, title, url) {
  return await page.evaluate(`(async () => (await chrome.bookmarks.create(${JSON.stringify({ parentId, title, url })})).id)()`);
}

async function addFolder(page, parentId, title) {
  return await page.evaluate(`(async () => (await chrome.bookmarks.create(${JSON.stringify({ parentId, title })})).id)()`);
}

async function removeNode(page, id) {
  return await page.evaluate(`(async () => { const n = (await chrome.bookmarks.get(${JSON.stringify(id)}))[0]; if (n.url) await chrome.bookmarks.remove(n.id); else await chrome.bookmarks.removeTree(n.id); return true; })()`);
}

async function renameNode(page, id, title) {
  return await page.evaluate(`(async () => { await chrome.bookmarks.update(${JSON.stringify(id)}, { title: ${JSON.stringify(title)} }); return true; })()`);
}

async function findNode(page, title) {
  return await page.evaluate(`(async () => {
    const tree = await chrome.bookmarks.getTree();
    let hit = null;
    const walk = (n) => {
      if (hit) return;
      if (n.title && n.title.indexOf('[本机备份]') === 0) return; // 跳过本机备份子树
      if (n.title === ${JSON.stringify(title)}) { hit = { id: n.id, url: n.url }; return; }
      (n.children||[]).forEach(walk);
    };
    tree.forEach(walk);
    return hit;
  })()`);
}

async function main() {
  await cleanCloud();
  const profileA = mkdtempSync(join(tmpdir(), 'udasyn-a-'));
  const profileB = mkdtempSync(join(tmpdir(), 'udasyn-b-'));
  const portA = 9471;
  const portB = 9472;
  launchChrome('A', portA, profileA);
  launchChrome('B', portB, profileB);

  try {
    await waitForBrowser(portA);
    await waitForBrowser(portB);
    const extA = await extensionId(portA);
    const extB = await extensionId(portB);
    console.log(`扩展已加载：A=${extA} B=${extB}`);

    const pageA = await openOptions(portA, extA);
    const pageB = await openOptions(portB, extB);

    // --- 场景 1：A 首次绑定，云端为空，直接推送 ---
    const workA = await addFolder(pageA, '1', '工作');
    await addBookmark(pageA, workA, 'GitHub', 'https://github.com');
    await addBookmark(pageA, workA, 'Figma', 'https://figma.com');

    const r1 = await bind(pageA);
    await pauseAuto(pageA);
    check('A 首次绑定成功', r1?.ok === true && !payload(r1)?.needsConfirm, JSON.stringify(r1 ?? {}));

    const s1 = await stateOf(pageA);
    const counts1 = s1?.data?.stats?.lastCounts;
    check('A 首次推送统计正常', s1?.data?.stats?.lastStatus === 'ok', `status=${s1?.data?.stats?.lastStatus} counts=${JSON.stringify(counts1)}`);
    const hasBackup = (await treeTitles(pageA)).some((t) => t.startsWith('[本机备份]'));
    check('A 生成本机备份文件夹', hasBackup);
    if (!hasBackup) console.log('--- A 日志 ---\n' + (await logs(pageA)));

    // --- 场景 2：B 有本地书签 + 同名文件夹，绑定时应预览再合并 ---
    const workB = await addFolder(pageB, '1', '工作'); // 同名文件夹：应被去重
    await addBookmark(pageB, workB, 'B站', 'https://bilibili.com');
    const readB = await addFolder(pageB, '1', '阅读');
    await addBookmark(pageB, readB, '少数派', 'https://sspai.com');

    const r2 = await bind(pageB);
    await pauseAuto(pageB);
    check('B 首次绑定返回合并预览', r2?.ok === true && payload(r2)?.needsConfirm === true && payload(r2)?.summary?.create > 0, JSON.stringify(payload(r2)?.summary ?? r2?.error));

    const r3 = await call(pageB, { type: 'CONFIRM_FIRST_SYNC' });
    check('B 确认合并成功', r3?.ok === true && !r3?.error, JSON.stringify(payload(r3)?.counts ?? r3?.error));

    const titlesB = (await treePaths(pageB)).filter((p) => !p.includes('[本机备份]')).map((p) => p.split('/').pop().replace(' <url>', ''));
    check('B 合并后包含 A 的 GitHub', titlesB.includes('GitHub'));
    check('B 合并后包含 A 的 Figma', titlesB.includes('Figma'));
    check('B 保留自己的 少数派', titlesB.includes('少数派'));
    check('B 合并后「工作」文件夹只有一个', titlesB.filter((t) => t === '工作').length === 1, `实际 ${titlesB.filter((t) => t === '工作').length} 个`);

    // --- 场景 3：A 拉取 B 的新增 ---
    const r4 = await syncNow(pageA);
    check('A 手动同步成功', r4?.ok === true, JSON.stringify(r4?.error ?? r4?.counts));
    const titlesA = await treeTitles(pageA);
    check('A 收到 B 的「少数派」', titlesA.includes('少数派'));
    check('A 收到 B 的「B站」', titlesA.includes('B站'));

    // --- 场景 4：B 删除，A 跟随删除 ---
    const bz = await findNode(pageB, 'B站');
    await removeNode(pageB, bz.id);
    const sb = await syncNow(pageB);
    check('B 删除后同步成功', sb?.ok === true, String(sb?.error ?? ''));
    await syncNow(pageA);
    const titlesA2 = await treeTitles(pageA);
    check('A 跟随删除了「B站」', !titlesA2.includes('B站'));
    if (titlesA2.includes('B站')) {
      console.log('--- A 日志 ---\n' + (await logs(pageA)));
      console.log('--- A 树 ---\n' + (await treePaths(pageA)).join('\n'));
      console.log('--- B 树 ---\n' + (await treePaths(pageB)).join('\n'));
      console.log('--- A 本地墓碑 ---', await pageA.evaluate(`(async()=>JSON.stringify(await chrome.storage.local.get('tomb')))()`));
      console.log('--- B 本地墓碑 ---', await pageB.evaluate(`(async()=>JSON.stringify(await chrome.storage.local.get('tomb')))()`));
    }

    // --- 场景 5：冲突，后写赢 ---
    const ghA = await findNode(pageA, 'GitHub');
    await renameNode(pageA, ghA.id, 'GitHub-A');
    await new Promise((r) => setTimeout(r, 1200));
    const ghB = await findNode(pageB, 'GitHub'); // 此时 B 里标题仍是 GitHub
    if (!ghB) throw new Error('B 端找不到 GitHub，无法测试冲突');
    await renameNode(pageB, ghB.id, 'GitHub-B');
    await new Promise((r) => setTimeout(r, 300));

    await syncNow(pageA); // A 先推
    await syncNow(pageB); // B 后推（时间更新）
    await syncNow(pageA); // A 再拉

    const titleA = (await findNode(pageA, 'GitHub-A')) || (await findNode(pageA, 'GitHub-B'));
    const finalTitlesA = await treeTitles(pageA);
    check('冲突后写赢（B 的改名生效）', finalTitlesA.includes('GitHub-B') && !finalTitlesA.includes('GitHub-A'));

    // --- 场景 6：UI 冒烟 ---
    const popup = await openTab(portA, `chrome-extension://${extA}/popup.html`);
    const popupSession = await CdpSession.connect(popup.webSocketDebuggerUrl);
    await popupSession.send('Runtime.enable');
    await new Promise((r) => setTimeout(r, 1200));
    const popupText = await popupSession.evaluate('document.body.innerText');
    check('popup 渲染出状态信息', typeof popupText === 'string' && popupText.includes('UDaSync') && popupText.includes('上次同步'));

    const s = await stateOf(pageA);
    check('设备列表包含两台', (s?.data?.stats?.devices ?? []).length >= 2, JSON.stringify((s?.data?.stats?.devices ?? []).map((d) => d.name)));

    popupSession.close();
    pageA.close();
    pageB.close();
  } finally {
    try {
      spawn('pkill', ['-f', `user-data-dir=${profileA}`]);
      spawn('pkill', ['-f', `user-data-dir=${profileB}`]);
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(profileA, { recursive: true, force: true });
      rmSync(profileB, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== E2E：${results.length - failed.length}/${results.length} 通过 ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 异常：', err);
  process.exit(1);
});
