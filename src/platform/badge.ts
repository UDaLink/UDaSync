/** 设备徽标/角标：同步失败标红，正常清除。 */

export async function setBadge(status: 'ok' | 'error' | 'syncing' | 'paused'): Promise<void> {
  try {
    if (status === 'error') {
      await chrome.action.setBadgeBackgroundColor({ color: '#C0392B' });
      await chrome.action.setBadgeText({ text: '!' });
    } else if (status === 'syncing') {
      await chrome.action.setBadgeBackgroundColor({ color: '#2D7FF9' });
      await chrome.action.setBadgeText({ text: '…' });
    } else if (status === 'paused') {
      await chrome.action.setBadgeBackgroundColor({ color: '#8E8E93' });
      await chrome.action.setBadgeText({ text: 'II' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    /* 图标不可用时不阻塞同步 */
  }
}
