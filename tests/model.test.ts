import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/core/model';
import type { IdMap, TreeNode } from '../src/shared/types';

const tree = (over: Partial<TreeNode> = {}): TreeNode => ({
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      title: 'Bookmarks bar',
      children: [
        { id: '10', title: 'A', url: 'https://a.com' },
        { id: '11', title: 'Folder', children: [{ id: '12', title: 'B', url: 'https://b.com' }] },
      ],
      ...over,
    },
    { id: '2', title: 'Other bookmarks', children: [] },
    { id: '3', title: 'Mobile bookmarks', children: [] },
  ],
});

const emptyIds = (): IdMap => ({ byUuid: {}, byChrome: {}, meta: {} });

describe('buildModel', () => {
  it('首次构建为每个节点生成 UUID 与指纹', () => {
    const res = buildModel({ tree: tree(), ids: emptyIds(), tombs: {}, now: 1000 });
    expect(res.model.items).toHaveLength(3);
    expect(Object.keys(res.ids.byChrome).sort()).toEqual(['1', '10', '11', '12', '2', '3']);
    expect(new Set(Object.values(res.ids.byUuid)).size).toBe(6);
  });

  it('根节点 id 不是 1/2/3 时仍按位置识别三个根', () => {
    const custom = tree();
    custom.children = [
      { id: '7001', title: '书签栏', children: [{ id: '7010', title: 'X', url: 'https://x.com' }] },
      { id: '7002', title: '其他书签', children: [] },
      { id: '7003', title: '移动端书签', children: [] },
    ];
    const res = buildModel({ tree: custom, ids: emptyIds(), tombs: {}, now: 1000 });
    expect(res.ids.byChrome['7001']).toBe('r:1');
    expect(res.ids.byChrome['7002']).toBe('r:2');
    expect(res.ids.byChrome['7003']).toBe('r:3');
    expect(res.model.items.find((i) => i.title === 'X')?.parentUuid).toBe('r:1');
    expect(res.model.nodes.find((n) => n.id === 'r:1')?.title).toBe('书签栏');
  });

  it('内容不变时 updatedAt 保持稳定（不产生回声）', () => {
    const first = buildModel({ tree: tree(), ids: emptyIds(), tombs: {}, now: 1000 });
    const second = buildModel({ tree: tree(), ids: first.ids, tombs: first.tombs, now: 9000 });
    expect(second.model.items.map((i) => i.uuid)).toEqual(first.model.items.map((i) => i.uuid));
    const before = first.ids.meta;
    for (const [id, meta] of Object.entries(before)) {
      expect(second.ids.meta[id]!.updatedAt).toBe(meta.updatedAt);
    }
  });

  it('标题变化会推进 updatedAt', () => {
    const first = buildModel({ tree: tree(), ids: emptyIds(), tombs: {}, now: 1000 });
    const changed = tree();
    changed.children![0]!.children![0]!.title = 'A2';
    const second = buildModel({ tree: changed, ids: first.ids, tombs: first.tombs, now: 9000 });
    const uuid = second.ids.byChrome['10']!;
    expect(second.ids.meta[uuid]!.updatedAt).toBe(9000);
  });

  it('本地删除会落墓碑', () => {
    const first = buildModel({ tree: tree(), ids: emptyIds(), tombs: {}, now: 1000 });
    const changed = tree();
    changed.children![0]!.children = [{ id: '11', title: 'Folder', children: [] }];
    const second = buildModel({ tree: changed, ids: first.ids, tombs: first.tombs, now: 9000 });
    const removedUuid = first.ids.byChrome['10']!;
    expect(second.model.removedUuids).toContain(removedUuid);
    expect(second.tombs[removedUuid]?.deletedAt).toBe(9000);
  });

  it('本机备份文件夹不参与同步', () => {
    const withBackup = tree();
    withBackup.children![0]!.children!.push({
      id: '99',
      title: '[本机备份] Mac 20261126',
      children: [{ id: '100', title: 'X', url: 'https://x.com' }],
    });
    const res = buildModel({ tree: withBackup, ids: emptyIds(), tombs: {}, now: 1000 });
    expect(res.model.items.find((i) => i.chromeId === '99')).toBeUndefined();
    expect(res.model.items.find((i) => i.chromeId === '100')).toBeUndefined();
  });
});
