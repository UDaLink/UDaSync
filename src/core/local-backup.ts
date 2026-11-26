/** 首次同步前，把本机原始书签树完整备份为一个本地文件夹（不参与同步）。 */

import { LOCAL_BACKUP_PREFIX } from '../shared/constants';
import type { TreeNode } from '../shared/types';

export interface BackupApi {
  create(args: { parentId: string; title: string; url?: string; index?: number }): Promise<{ id: string }>;
  getChildren(parentId: string): Promise<TreeNode[]>;
}

export async function createLocalBackupFolder(
  api: BackupApi,
  deviceName: string,
  now: Date,
  barChromeId: string,
): Promise<{ folderId: string; count: number }> {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const name = `${LOCAL_BACKUP_PREFIX} ${deviceName} ${stamp}`;
  const folder = await api.create({ parentId: barChromeId, title: name });
  let count = 0;

  const copyRecursive = async (sourceParentId: string, targetParentId: string) => {
    const children = await api.getChildren(sourceParentId);
    for (const child of children) {
      // 不复制备份文件夹自身，避免递归嵌套
      if (child.title.startsWith(LOCAL_BACKUP_PREFIX)) continue;
      const created = await api.create({
        parentId: targetParentId,
        title: child.title,
        url: child.url,
      });
      count++;
      if (!child.url) await copyRecursive(child.id, created.id);
    }
  };

  await copyRecursive(barChromeId, folder.id);
  return { folderId: folder.id, count };
}
