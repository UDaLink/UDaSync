/**
 * 极简 CDP 客户端（Node 22 自带 WebSocket）。
 * 只做三件事：连接 target、发命令、在页面上下文里执行表达式。
 */

export class CdpSession {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new CdpSession(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  /** 在页面上下文执行表达式；表达式可以返回 Promise */
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const text =
        res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        JSON.stringify(res.exceptionDetails);
      throw new Error(`页面执行出错: ${text}`);
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export async function waitForBrowser(port, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* 等端口 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`浏览器调试端口 ${port} 未就绪`);
}

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return await res.json();
}

export async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return await res.json();
}

export async function waitForTarget(port, predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await listTargets(port);
      const hit = targets.find(predicate);
      if (hit) return hit;
    } catch {
      /* 端口还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等待调试目标超时');
}

/** 轮询直到表达式返回真值 */
export async function waitUntil(session, expression, label, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await session.evaluate(expression);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`等待超时：${label}`);
}
