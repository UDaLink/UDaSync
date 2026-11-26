/** chrome.bookmarks 的最小封装，让 core 层不直接依赖浏览器全局。 */

import type { TreeNode } from '../shared/types';
import type { ApplyApi } from '../core/apply';
import type { BackupApi } from '../core/local-backup';

export const bookmarkApi: ApplyApi & BackupApi = {
  async getChildren(parentId: string): Promise<TreeNode[]> {
    const children = await chrome.bookmarks.getChildren(parentId);
    return children.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      index: c.index,
      title: c.title,
      url: c.url,
    }));
  },
  async create(args: { parentId: string; title: string; url?: string; index?: number }) {
    const node = await chrome.bookmarks.create({
      parentId: args.parentId,
      title: args.title,
      ...(args.url ? { url: args.url } : {}),
      ...(args.index !== undefined ? { index: args.index } : {}),
    });
    return { id: node.id };
  },
  async update(id: string, changes: { title?: string; url?: string }) {
    await chrome.bookmarks.update(id, changes);
  },
  async move(id: string, args: { parentId: string; index: number }) {
    await chrome.bookmarks.move(id, args);
  },
  async remove(id: string) {
    await chrome.bookmarks.remove(id);
  },
  async removeTree(id: string) {
    await chrome.bookmarks.removeTree(id);
  },
};

export async function getBookmarkTree(): Promise<TreeNode> {
  const tree = await chrome.bookmarks.getTree();
  return tree[0] as unknown as TreeNode;
}
