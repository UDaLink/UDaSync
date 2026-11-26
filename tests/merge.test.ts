import { describe, expect, it } from 'vitest';
import { mergeNodes, tombstonesToNodes } from '../src/core/merge';
import type { BookmarkNode } from '../src/shared/types';
import { ROOT_BAR, ROOT_OTHER, TOMBSTONE_TTL_MS } from '../src/shared/constants';

const now = 1_000_000_000_000;

function n(
  id: string,
  parentId: string,
  title: string,
  opts: Partial<BookmarkNode> & { url?: string } = {},
): BookmarkNode {
  return {
    id,
    parentId,
    kind: opts.url ? 'bookmark' : 'folder',
    title,
    url: opts.url,
    index: opts.index ?? 0,
    createdAt: opts.createdAt ?? 1000,
    updatedAt: opts.updatedAt ?? 1000,
    deletedAt: opts.deletedAt,
    aliases: opts.aliases,
  };
}

const localBase: BookmarkNode[] = [
  n('r:0', null as unknown as string, 'root', { createdAt: 0 }),
  n(ROOT_BAR, 'r:0', 'Bookmarks bar', { createdAt: 0, updatedAt: 0 }),
  n(ROOT_OTHER, 'r:0', 'Other bookmarks', { createdAt: 0, updatedAt: 0 }),
];

describe('mergeNodes', () => {
  it('合并两台设备的并集', () => {
    const local = [...localBase, n('f1', ROOT_BAR, '工作', { index: 0 }), n('b1', 'f1', 'GitHub', { url: 'https://github.com', index: 0 })];
    const remote = [
      n('r:1', 'r:0', 'Bookmarks bar'),
      n('r:2', 'r:0', 'Other bookmarks'),
      n('f1', ROOT_BAR, '工作'),
      n('b2', 'f1', 'Figma', { url: 'https://figma.com', index: 1 }),
    ];
    const res = mergeNodes(local, [remote], now);
    const ids = res.alive.map((x) => x.id);
    expect(ids).toContain('b1');
    expect(ids).toContain('b2');
    expect(res.alive.filter((x) => x.title === 'GitHub')).toHaveLength(1);
  });

  it('同 id 冲突时后写赢', () => {
    const local = [...localBase, n('b1', ROOT_BAR, '旧标题', { url: 'https://a.com', updatedAt: 5000 })];
    const remote = [...localBase, n('b1', ROOT_BAR, '新标题', { url: 'https://a.com', updatedAt: 9000 })];
    const res = mergeNodes(local, [remote], now);
    expect(res.alive.find((x) => x.id === 'b1')?.title).toBe('新标题');
  });

  it('墓碑传播删除', () => {
    const local = [...localBase, n('b1', ROOT_BAR, 'A', { url: 'https://a.com', updatedAt: now - 5000 })];
    const remote = [...localBase, n('b1', ROOT_BAR, 'A', { url: 'https://a.com', deletedAt: now - 1000, updatedAt: now - 1000 })];
    const res = mergeNodes(local, [remote], now);
    expect(res.alive.find((x) => x.id === 'b1')).toBeUndefined();
    expect(res.newTombstones['b1']).toBeDefined();
  });

  it('父节点被删则子节点级联删除', () => {
    const local = [...localBase, n('f1', ROOT_BAR, 'F'), n('b1', 'f1', 'A', { url: 'https://a.com' })];
    const remote = [
      ...localBase,
      n('f1', ROOT_BAR, 'F', { deletedAt: now - 500, updatedAt: now - 500 }),
    ];
    const res = mergeNodes(local, [remote], now);
    expect(res.alive.find((x) => x.id === 'f1')).toBeUndefined();
    expect(res.alive.find((x) => x.id === 'b1')).toBeUndefined();
  });

  it('同父同名文件夹合并，子节点改挂存活者', () => {
    const local = [
      ...localBase,
      n('f-old', ROOT_BAR, '工作', { createdAt: 100 }),
      n('b-local', 'f-old', 'A', { url: 'https://a.com' }),
    ];
    const remote = [
      ...localBase,
      n('f-new', ROOT_BAR, '工作', { createdAt: 500 }),
      n('b-remote', 'f-new', 'B', { url: 'https://b.com' }),
    ];
    const res = mergeNodes(local, [remote], now);
    const survivors = res.alive.filter((x) => x.title === '工作');
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id).toBe('f-old');
    expect(res.alive.find((x) => x.id === 'b-remote')?.parentId).toBe('f-old');
    expect(res.alive.find((x) => x.id === 'f-new')).toBeUndefined();
    expect(res.newTombstones['f-new']).toBeDefined();
  });

  it('别名把旧 id 归并到新节点', () => {
    const local = [...localBase, n('b-new', ROOT_BAR, 'A', { url: 'https://a.com', aliases: ['b-old'] })];
    const remote = [...localBase, n('b-old', ROOT_BAR, 'A', { url: 'https://a.com' })];
    const res = mergeNodes(local, [remote], now);
    const alive = res.alive.filter((x) => x.title === 'A');
    expect(alive).toHaveLength(1);
    expect(alive[0]!.id).toBe('b-new');
  });

  it('超过 TTL 的墓碑不再随快照上传', () => {
    const old = now - TOMBSTONE_TTL_MS - 1000;
    const local = [...localBase, n('b1', ROOT_BAR, 'A', { url: 'https://a.com', deletedAt: old, updatedAt: old })];
    const res = mergeNodes(local, [], now);
    expect(res.all.find((x) => x.id === 'b1')).toBeUndefined();
  });

  it('兄弟顺序按 index 排序并重新编号', () => {
    const local = [
      ...localBase,
      n('a', ROOT_BAR, 'A', { url: 'https://a.com', index: 2 }),
      n('b', ROOT_BAR, 'B', { url: 'https://b.com', index: 1 }),
      n('c', ROOT_BAR, 'C', { url: 'https://c.com', index: 0 }),
    ];
    const res = mergeNodes(local, [], now);
    const kids = res.alive.filter((x) => x.parentId === ROOT_BAR);
    expect(kids.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(kids.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it('tombstonesToNodes 可回写上传结构', () => {
    const nodes = tombstonesToNodes({ x: { deletedAt: 5, parentId: 'r:1', title: 'X', kind: 'bookmark', url: 'https://x' } });
    expect(nodes[0]!.deletedAt).toBe(5);
    expect(nodes[0]!.id).toBe('x');
  });
});
