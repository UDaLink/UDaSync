import { describe, expect, it } from 'vitest';
import { isLikelyLocalWipe, summarizeDiff } from '../src/core/plan';
import { mergeNodes } from '../src/core/merge';
import type { BookmarkNode, LocalItem } from '../src/shared/types';
import { ROOT_BAR } from '../src/shared/constants';

const now = 1_000_000_000_000;

const node = (id: string, parentId: string, title: string, url?: string, index = 0): BookmarkNode => ({
  id,
  parentId,
  kind: url ? 'bookmark' : 'folder',
  title,
  url,
  index,
  createdAt: 1,
  updatedAt: 1,
});

const item = (uuid: string, parentUuid: string, title: string, url?: string, index = 0): LocalItem => ({
  uuid,
  chromeId: `c-${uuid}`,
  parentUuid,
  kind: url ? 'bookmark' : 'folder',
  title,
  url,
  index,
});

describe('isLikelyLocalWipe', () => {
  it('本机清空且云端有数据时拦截', () => {
    expect(isLikelyLocalWipe(0, 50, false)).toBe(true);
    expect(isLikelyLocalWipe(2, 20, false)).toBe(true);
    expect(isLikelyLocalWipe(3, 50, false)).toBe(false);
    expect(isLikelyLocalWipe(0, 19, false)).toBe(false);
  });
  it('用户已确认首次合并时放行（用于从云端恢复）', () => {
    expect(isLikelyLocalWipe(0, 50, true)).toBe(false);
  });
});

describe('summarizeDiff', () => {
it('统计新增/删除/更新/移动', () => {
    const local = [item('a', ROOT_BAR, 'A', 'https://a.com'), item('b', ROOT_BAR, 'B', 'https://b.com')];
    const target = [node('a', ROOT_BAR, 'A2', 'https://a.com'), node('c', ROOT_BAR, 'C', 'https://c.com', 1)];
    const s = summarizeDiff(local, target);
    expect(s.create).toBe(1);
    expect(s.update).toBe(1);
    expect(s.remove).toBe(1);
  });

  it('合并后与本地完全一致时无变更', () => {
    const local = [item('a', ROOT_BAR, 'A', 'https://a.com')];
    const target = mergeNodes(
      [
        { ...node('r:0', '' as unknown as string, 'root'), parentId: null },
        { ...node(ROOT_BAR, 'r:0', 'bar'), createdAt: 0, updatedAt: 0 },
        node('a', ROOT_BAR, 'A', 'https://a.com'),
      ],
      [],
      now,
    ).alive.filter((x) => x.id !== 'r:0');
    const s = summarizeDiff(local, target);
    expect(s.create + s.remove + s.update + s.move).toBe(0);
  });
});
