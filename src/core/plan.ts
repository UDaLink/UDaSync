/** 差异摘要：用于首页状态与首次同步预览，不执行任何写操作。 */

import { ROOTS, ROOT_UUIDS_BY_INDEX, ROOT_UUID } from '../shared/constants';
import type { BookmarkNode, LocalItem, PlanSummary } from '../shared/types';

const FIXED = new Set<string>([ROOT_UUID, ...ROOTS.map((r) => r.uuid)]);

export function isLikelyLocalWipe(localAlive: number, remoteAlive: number, confirmed: boolean): boolean {
  if (confirmed) return false;
  // 本机近乎为空、云端却有大量数据：多半是浏览器同步被关/配置被清，先停下保护云端
  return localAlive <= 2 && remoteAlive >= 20;
}

export function summarizeDiff(localItems: LocalItem[], target: BookmarkNode[]): PlanSummary {
  const alive = target.filter((n) => !n.deletedAt && !FIXED.has(n.id));
  const aliveById = new Map(alive.map((n) => [n.id, n]));
  const localById = new Map(localItems.map((i) => [i.uuid, i]));

  let create = 0;
  let update = 0;
  let move = 0;
  let reorder = 0;
  let remove = 0;
  const createdTitles: string[] = [];
  const removedTitles: string[] = [];

  for (const n of alive) {
    const l = localById.get(n.id);
    if (!l) {
      create++;
      if (createdTitles.length < 8) createdTitles.push(n.title);
      continue;
    }
    if (l.title !== n.title || (l.url ?? '') !== (n.url ?? '')) update++;
    if (l.parentUuid !== n.parentId) move++;
    else if (l.index !== n.index) reorder++;
  }
  for (const l of localItems) {
    if (!aliveById.has(l.uuid)) {
      remove++;
      if (removedTitles.length < 8) removedTitles.push(l.title);
    }
  }

  return {
    create,
    update,
    move,
    reorder,
    remove,
    samples: { create: createdTitles, remove: removedTitles },
  };
}
