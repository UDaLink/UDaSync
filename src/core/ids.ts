/** 纯工具：UUID 与内容指纹。不依赖任何浏览器 API，可在 Node 中测试。 */

export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 兜底：不用于安全场景，仅作为标识符
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** FNV-1a 32 位 + 长度，足够做内容变更检测（非加密用途） */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${input.length}`;
}

export function nodeHash(parts: {
  title: string;
  url?: string;
  parentId: string | null;
  index: number;
  kind: string;
}): string {
  return hashString(
    [parts.kind, parts.title, parts.url ?? '', parts.parentId ?? '', String(parts.index)].join('\u0001'),
  );
}

export function base64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
