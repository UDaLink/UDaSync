/**
 * 三向合并引擎（纯函数）。
 *
 * 输入：本机快照 + 所有远端设备快照（每个快照都包含墓碑）。
 * 规则：
 *  1. 同一 id 取 revision 最大的记录（revision = max(updatedAt, deletedAt)），后写赢；
 *  2. 别名（aliases）展开：历史 id 归并到存活节点；
 *  3. 同父同名的文件夹视为同一个：选 createdAt 最早的为存活者，其余变墓碑，子节点改挂；
 *  4. 父节点已删的子节点级联删除；
 *  5. 兄弟节点按 index 排序并重新编号，保证输出稳定。
 */

import { ROOT_UUID, ROOT_BAR, ROOT_OTHER, ROOT_MOBILE, ROOT_TITLES, TOMBSTONE_TTL_MS } from '../shared/constants';
import type { BookmarkNode, TombstoneRecord, Tombstones } from '../shared/types';

export interface MergeResult {
  /** 存活的节点，按 BFS 顺序（父先于子） */
  alive: BookmarkNode[];
  /** 全部节点（含墓碑），用于上传 */
  all: BookmarkNode[];
  /** 新增的墓碑（用于回写本地 tombs） */
  newTombstones: Tombstones;
}

const FIXED_ROOT_ORDER = new Map<string, number>([
  [ROOT_BAR, 0],
  [ROOT_OTHER, 1],
  [ROOT_MOBILE, 2],
]);

function revisionOf(n: BookmarkNode): number {
  return Math.max(n.updatedAt ?? 0, n.deletedAt ?? 0);
}

function tieKey(n: BookmarkNode): string {
  return `${revisionOf(n).toString().padStart(16, '0')}|${n.id}`;
}

export function mergeNodes(
  localNodes: BookmarkNode[],
  remoteNodesList: BookmarkNode[][],
  now: number,
): MergeResult {
  // ---- 1. 收集并选出每个 id 的最新记录 ----
  const best = new Map<string, BookmarkNode>();
  const aliasToId = new Map<string, string>();

  const consider = (n: BookmarkNode) => {
    const cur = best.get(n.id);
    if (!cur || tieKey(n) > tieKey(cur)) best.set(n.id, n);
  };

  for (const n of localNodes) consider(n);
  for (const list of remoteNodesList) for (const n of list) consider(n);
  for (const list of remoteNodesList) for (const n of list) for (const a of n.aliases ?? []) aliasToId.set(a, n.id);
  for (const n of localNodes) for (const a of n.aliases ?? []) aliasToId.set(a, n.id);

  const canonical = (id: string | null): string | null => {
    if (!id) return null;
    let seen = new Set<string>();
    let cur = id;
    while (aliasToId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const next = aliasToId.get(cur)!;
      if (next === cur) break;
      cur = next;
    }
    return cur;
  };

  // 记录被别的节点声明为 alias 的 id，避免它们作为独立节点存在
  const absorbed = new Set<string>();
  for (const [alias, owner] of aliasToId) if (alias !== owner) absorbed.add(alias);

  // ---- 2. 修复 parentId 并剔除被吸收的节点 ----
  const nodes = new Map<string, BookmarkNode>();
  for (const [id, n] of best) {
    if (absorbed.has(id)) continue;
    nodes.set(id, { ...n, parentId: canonical(n.parentId) });
  }

  // ---- 3. 固定根节点保障 ----
  const rootNode = (id: string, index: number): BookmarkNode => ({
    id,
    parentId: ROOT_UUID,
    kind: 'folder',
    title: id,
    index,
    createdAt: 0,
    updatedAt: 0,
  });
  nodes.set(
    ROOT_UUID,
    nodes.get(ROOT_UUID) ?? {
      id: ROOT_UUID,
      parentId: null,
      kind: 'folder',
      title: 'root',
      index: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  );
  for (const r of [ROOT_BAR, ROOT_OTHER, ROOT_MOBILE]) {
    if (!nodes.has(r)) nodes.set(r, rootNode(r, FIXED_ROOT_ORDER.get(r) ?? 0));
    nodes.get(r)!.title = ROOT_TITLES[r] ?? nodes.get(r)!.title;
    const n = nodes.get(r)!;
    n.parentId = ROOT_UUID;
    n.kind = 'folder';
    n.index = FIXED_ROOT_ORDER.get(r) ?? 0;
    n.deletedAt = undefined;
  }

  // ---- 4. 同父同名文件夹去重 ----
  const dedupeKey = (n: BookmarkNode) => `${n.parentId ?? ''}\u0000${n.title.trim()}`;
  const folderGroups = new Map<string, BookmarkNode[]>();
  for (const n of nodes.values()) {
    if (n.deletedAt || n.kind !== 'folder') continue;
    if (FIXED_ROOT_ORDER.has(n.id) || n.id === ROOT_UUID) continue;
    const k = dedupeKey(n);
    const arr = folderGroups.get(k);
    if (arr) arr.push(n);
    else folderGroups.set(k, [n]);
  }

  const survivorsByLoserId = new Map<string, string>();
  for (const group of folderGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const survivor = group[0]!;
    for (const loser of group.slice(1)) {
      survivorsByLoserId.set(loser.id, survivor.id);
      // 不把 loser.id 放进 survivor.aliases：否则 loser 会被当作「被吸收」直接丢弃，
      // 其它设备就收不到这次去重对应的墓碑，重复文件夹会复活。
      const mergedAliases = new Set<string>([...(survivor.aliases ?? []), ...(loser.aliases ?? [])]);
      survivor.aliases = mergedAliases.size ? [...mergedAliases] : undefined;
      loser.deletedAt = now;
      loser.updatedAt = now;
    }
  }

  // 被合并掉的孩子改挂到存活者
  for (const n of nodes.values()) {
    if (!n.parentId) continue;
    const mapped = canonical(n.parentId) ?? n.parentId;
    const viaDedupe = survivorsByLoserId.get(mapped) ?? mapped;
    n.parentId = viaDedupe;
  }

  // ---- 5. 级联删除 ----
  const aliveOrphanCheck = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes.values()) {
        if (n.deletedAt || n.id === ROOT_UUID) continue;
        const p = n.parentId;
        if (!p) continue;
        const parent = nodes.get(p);
        if (!parent || parent.deletedAt) {
          n.deletedAt = now;
          n.updatedAt = now;
          changed = true;
        }
      }
    }
  };
  aliveOrphanCheck();

  // ---- 6. 排序与编号 ----
  const childrenOf = new Map<string | null, BookmarkNode[]>();
  for (const n of nodes.values()) {
    if (n.deletedAt) continue;
    const key = n.parentId ?? null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(n);
    else childrenOf.set(key, [n]);
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => {
      if (a.parentId === ROOT_UUID) return (FIXED_ROOT_ORDER.get(a.id) ?? 9) - (FIXED_ROOT_ORDER.get(b.id) ?? 9);
      return a.index - b.index || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
    arr.forEach((n, i) => {
      n.index = i;
    });
  }

  // ---- 7. BFS 输出 ----
  const alive: BookmarkNode[] = [];
  const queue: string[] = [ROOT_UUID];
  while (queue.length) {
    const id = queue.shift()!;
    const node = nodes.get(id);
    if (!node) continue;
    alive.push(node);
    for (const child of childrenOf.get(id) ?? []) queue.push(child.id);
  }

  // ---- 8. 墓碑整理：过期墓碑不再随快照上传 ----
  const all: BookmarkNode[] = [];
  const newTombstones: Tombstones = {};
  for (const n of nodes.values()) {
    if (n.deletedAt) {
      if (now - n.deletedAt > TOMBSTONE_TTL_MS) continue;
      const rec: TombstoneRecord = {
        deletedAt: n.deletedAt,
        parentId: n.parentId,
        title: n.title,
        kind: n.kind,
        url: n.url,
      };
      newTombstones[n.id] = rec;
    }
    all.push(n);
  }

  return { alive, all, newTombstones };
}

/** 由墓碑表构造可上传的节点 */
export function tombstonesToNodes(tombs: Tombstones): BookmarkNode[] {
  return Object.entries(tombs).map(([id, t]) => ({
    id,
    parentId: t.parentId,
    kind: t.kind,
    title: t.title,
    url: t.url,
    index: 0,
    createdAt: t.deletedAt,
    updatedAt: t.deletedAt,
    deletedAt: t.deletedAt,
  }));
}
