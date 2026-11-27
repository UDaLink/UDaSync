# 隐私说明

UDaSync 不收集、不上报、不出售任何用户数据。所有同步数据只在你的浏览器与本机配置的存储服务（坚果云 WebDAV、通用 WebDAV、123 云盘或 Microsoft OneDrive）之间传输。

## 1. 处理哪些数据

| 数据 | 用途 | 存放位置 |
| --- | --- | --- |
| 书签标题、网址、文件夹层级与顺序 | 同步的唯一对象 | 本机浏览器 + 你选择的云盘 |
| 坚果云账号、应用密码 | WebDAV 认证 | 本机 `chrome.storage.local` |
| 通用 WebDAV 地址、账号、应用密码 | WebDAV 认证 | 本机 `chrome.storage.local` |
| 123 云盘账号、应用密码 | 123 云盘 WebDAV 认证 | 本机 `chrome.storage.local` |
| OneDrive client ID、access/refresh token、账号标识 | Graph 认证 | 本机 `chrome.storage.local`；client ID 会写入配置 |
| 设备 ID、设备名 | 区分多台设备的快照 | 本机 + 云端快照元数据 |
| 同步日志、回收站 | 排错与误删恢复 | 本机 `chrome.storage.local` |
| 云端备份 | 回滚 | 坚果云 `/dav/UDaSync/backups/`、通用 WebDAV `<根>/UDaSync/backups/`、123 云盘 `授权文件夹/UDaSync/backups/` 或 OneDrive `Apps/UDaSync/backups/` |

不处理：网页内容、浏览历史、Cookie、密码、表单数据、地理位置、剪贴板。

## 2. 权限用途

| 权限 | 为什么需要 |
| --- | --- |
| `bookmarks` | 读取并写入书签树，这是扩展的核心功能 |
| `storage` | 保存账号配置、设备 ID、UUID 映射、墓碑、日志、回收站 |
| `alarms` | 每 10 分钟轮询云端变更 |
| `notifications` | 连续同步失败时提醒用户 |
| `host_permissions: https://dav.jianguoyun.com/*` | 访问坚果云 WebDAV |
| `host_permissions: https://graph.microsoft.com/*` | 访问 OneDrive 文件与应用专属文件夹 |
| `host_permissions: https://login.microsoftonline.com/*` | OneDrive 设备代码登录与 token 刷新 |
| `host_permissions: https://*.1drv.com/*`、`https://*.sharepoint.com/*` | 跟随 Graph 302 到 OneDrive 预签名下载地址 |
| `optional_host_permissions: https://*/*`、`http://*/*` | 通用 WebDAV：在用户点击「测试连接 / 保存并连接」时，按所填地址请求具体主机的访问权限；123 云盘：只请求 `https://webdav.123pan.cn/*`。安装时均不授予 |

扩展不包含 content script，不注入任何网页，不读取页面内容。

## 3. 数据流向

```
浏览器书签 ──▶ 扩展（本机）──HTTPS/Basic Auth──▶ 你的坚果云 WebDAV
                    │
                    ├──HTTPS/Basic Auth──▶ 你填写的通用 WebDAV
                    │
                    ├──HTTPS/Basic Auth──▶ 123 云盘固定 WebDAV 入口
                    │
                    ├──HTTPS/Bearer token──▶ Microsoft Graph（OneDrive 应用专属文件夹）
                    │
                    └─▶ chrome.storage.local（仅本机）
```

- 没有中转服务器，没有遥测端点，没有第三方 SDK
- 坚果云、通用 WebDAV 与 123 云盘凭证仅用于 `Authorization: Basic` 请求头；OneDrive 使用 Bearer token
- 通用 WebDAV 的目标主机由用户填写，扩展只在用户点击时请求该主机的权限；123 云盘只访问固定入口 `https://webdav.123pan.cn/webdav`；不会扫描或访问其他网站
- 凭证不写入日志、不进入快照
- 云端快照包含书签内容，若云盘账号共享给他人，对方可读取这些文件
- OneDrive 的 `Files.ReadWrite.AppFolder` 权限只覆盖 `Apps/UDaSync/`，不包括其他网盘文件

## 4. 保留与删除

- 本机：卸载扩展即删除 `chrome.storage.local` 中的数据；书签本身仍保留在浏览器
- 坚果云：删除 `/dav/UDaSync/` 下的文件即可；建议先在设置页「设备」移除设备
- 通用 WebDAV：删除 `<WebDAV 根>/UDaSync/` 下的文件即可；断开连接只清除本机凭证，不会删除云端文件
- 123 云盘：删除授权文件夹下的 `UDaSync/` 即可；断开连接只清除本机 `pan123Account` / `pan123Password`，不会删除云端文件，也不影响通用 WebDAV 配置
- OneDrive：删除 `Apps/UDaSync/` 文件夹即可；断开连接只清除本机 token，不会删除云端文件
- 墓碑：保留 30 天后不再上传
- 回收站：保留 7 天或最多 300 条
- 云端备份：最多 10 份，按时间淘汰

## 5. 安全建议

1. 使用坚果云、通用 WebDAV 或 123 云盘的**应用密码**而非登录密码，泄露时可单独吊销
2. 不要把手动填写的 client ID 与应用密码写进代码仓库、截图或聊天记录
3. 通用 WebDAV 公网地址优先用 HTTPS；HTTP 只建议在可信局域网使用
4. 123 云盘只使用「第三方挂载」生成的账号与应用密码，不要填登录手机号/邮箱和主密码
5. OneDrive 授权只给 `Files.ReadWrite.AppFolder` + `User.Read`，不要给 `Files.ReadWrite.All`
6. 共用电脑时依赖操作系统账户隔离；v2 计划提供本地口令加密
7. 定期在服务商后台检查并清理不再使用的应用密码

## 6. 合规声明

扩展仅代表用户本人操作其自己的书签与云盘，不提供任何代理、爬取、数据交易能力。若用于企业环境，请遵循所在组织的终端与数据管理规定。
