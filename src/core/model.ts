/**
 * 从 Chrome 书签树构建本机同步模型（纯函数，便于测试）。
 * - 产生/复用稳定 UUID
 * - 维护内容指纹，只有内容真的变了才推进 updatedAt（避免全网回声）
 * - 识别本地删除并落地墓碑
 */

import { LOCAL_BACKUP_PREFIX, ROOT_TITLES, ROOT_UUIDS_BY_INDEX, TOMBSTONE_TTL_MS } from '../shared/constants';
import type { BookmarkNode, IdMap, LocalItem, LocalModel, Tombstones, TreeNode } from '../shared/types';
import { hashString, nodeHash, uuid } from './ids';

export interface BuildModelInput {
  tree: TreeNode;
  ids: IdMap;
  tombs: Tombstones;
  now: number;
}

export interface BuildModelOutput {
  model: LocalModel;
  ids: IdMap;
  tombs: Tombstones;
}

export function buildModel({ tree, ids, tombs, now }: BuildModelInput): BuildModelOutput {
  const nextIds: IdMap = {
    byUuid: { ...ids.byUuid },
    byChrome: { ...ids.byChrome },
    meta: { ...ids.meta },
  };
  const nextTombs: Tombstones = { ...tombs };
  const items: LocalItem[] = [];
  const nodes: BookmarkNode[] = [];
  const seenChromeIds = new Set<string>();
  const freshUuids: string[] = [];

  const roots = tree.children ?? [];

  // 虚拟根
  nodes.push({
    id: 'r:0',
    parentId: null,
    kind: 'folder',
    title: 'root',
    index: 0,
    createdAt: 0,
    updatedAt: 0,
  });

  const walk = (parent: TreeNode, parentUuid: string) => {
    const children = parent.children ?? [];
    children.forEach((child, index) => {
      // 本机备份子树不参与同步
      if (child.title.startsWith(LOCAL_BACKUP_PREFIX)) return;

      const chromeId = child.id;
      seenChromeIds.add(chromeId);

      let nodeUuid = nextIds.byChrome[chromeId];
      if (!nodeUuid) {
        nodeUuid = uuid();
        nextIds.byChrome[chromeId] = nodeUuid;
        nextIds.byUuid[nodeUuid] = chromeId;
        freshUuids.push(nodeUuid);
      } else {
        nextIds.byUuid[nodeUuid] = chromeId;
      }

      // 节点重新出现（用户手动恢复）→ 撤销墓碑
      if (nextTombs[nodeUuid]) delete nextTombs[nodeUuid];

      const kind = child.url ? 'bookmark' : 'folder';
      const hash = nodeHash({
        title: child.title,
        url: child.url,
        parentId: parentUuid,
        index,
        kind,
      });
      const meta = nextIds.meta[nodeUuid];
      let createdAt = meta?.createdAt ?? now;
      let updatedAt = meta?.updatedAt ?? now;
      if (meta && meta.hash !== hash) updatedAt = now;
      nextIds.meta[nodeUuid] = { createdAt, updatedAt, hash };

      const item: LocalItem = {
        uuid: nodeUuid,
        chromeId,
        parentUuid,
        kind,
        title: child.title,
        url: child.url,
        index,
      };
      items.push(item);

      nodes.push({
        id: nodeUuid,
        parentId: parentUuid,
        kind,
        title: child.title,
        url: child.url,
        index,
        createdAt,
        updatedAt,
      });

      if (kind === 'folder') walk(child, nodeUuid);
    });
  };

  // Chrome 根节点（id 0）下固定挂三个根：书签栏 / 其他书签 / 移动端书签。
  // 不同 profile 的根 id 不一定是 1/2/3（导入过书签的配置会变化），必须按位置识别。
  roots.forEach((rootChild, rootIndex) => {
    const fixedUuid = ROOT_UUIDS_BY_INDEX[rootIndex];
    if (!fixedUuid) {
      walk({ ...rootChild, children: rootChild.children ?? [] }, 'r:0');
      return;
    }
    seenChromeIds.add(rootChild.id);
    nextIds.byChrome[rootChild.id] = fixedUuid;
    nextIds.byUuid[fixedUuid] = rootChild.id;
    nextTombs[fixedUuid] && delete nextTombs[fixedUuid];
    nodes.push({
      id: fixedUuid,
      parentId: 'r:0',
      kind: 'folder',
      title: ROOT_TITLES[fixedUuid] ?? rootChild.title,
      index: rootIndex,
      createdAt: 0,
      updatedAt: 0,
    });
    walk(rootChild, fixedUuid);
  });

  // ---- 本地删除检测 ----
  const removedUuids: string[] = [];
  for (const [nodeUuid, chromeId] of Object.entries(nextIds.byUuid)) {
    if (chromeId === '0') continue;
    if (seenChromeIds.has(chromeId)) continue;
    // 根节点永不判删
    if (ROOT_UUIDS_BY_INDEX.includes(nodeUuid)) continue;
    const meta = nextIds.meta[nodeUuid];
    const item = items.find((i) => i.uuid === nodeUuid);
    if (!item && meta) {
      nextTombs[nodeUuid] = {
        deletedAt: now,
        parentId: null,
        title: '',
        kind: 'folder',
      };
      removedUuids.push(nodeUuid);
    }
    delete nextIds.byUuid[nodeUuid];
    delete nextIds.byChrome[chromeId];
  }

  // 本地删除的节点不进入 nodes（由墓碑统一表达）
  // 清理过期墓碑与孤儿映射
  for (const [id, t] of Object.entries(nextTombs)) {
    if (now - t.deletedAt > TOMBSTONE_TTL_MS) delete nextTombs[id];
  }
  for (const nodeUuid of Object.keys(nextIds.meta)) {
    if (!nextIds.byUuid[nodeUuid] && !nextTombs[nodeUuid]) delete nextIds.meta[nodeUuid];
  }

  const model: LocalModel = {
    items,
    nodes: nodes.map((n) => ({ ...n, updatedAt: n.updatedAt })),
    removedUuids,
    freshUuids,
  };

  // 用墓碑补齐 nodes（让合并引擎看到本机删除）
  for (const [id, t] of Object.entries(nextTombs)) {
    model.nodes.push({
      id,
      parentId: t.parentId,
      kind: t.kind,
      title: t.title,
      url: t.url,
      index: 0,
      createdAt: t.deletedAt,
      updatedAt: t.deletedAt,
      deletedAt: t.deletedAt,
    });
  }

  return { model, ids: nextIds, tombs: nextTombs };
}

/** 供测试与调试：把节点树扁平化为 BFS */
export function flattenNodes(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes.slice();
}

export function fingerprintNodes(nodes: BookmarkNode[]): string {
  const sorted = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => `${n.id}:${n.parentId}:${n.title}:${n.url ?? ''}:${n.index}:${n.updatedAt}`)
    .join('|');
  return hashString(sorted);
}
