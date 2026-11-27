# Changelog

所有重要变更都记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增第三个存储 provider「通用 WebDAV」，可填任意支持 Basic Auth 的 WebDAV 地址、账号与应用密码
- 通用 WebDAV 使用独立的 `webdavUrl` / `webdavAccount` / `webdavPassword` 配置，不改动坚果云与 OneDrive 的字段和行为
- 设置页新增独立「通用 WebDAV」面板、测试连接、保存并连接、断开并清除凭证
- 新增 `optional_host_permissions`，在用户点击测试/保存时按所填域名请求主机权限
- 新增 `WebDavAdapter` 与 provider 工厂、settings 隔离单元测试；WebDAV 解析测试补充大写 `D:` 与默认命名空间
- 新增第四个存储 provider「123 云盘」，固定使用官方 WebDAV 入口 `https://webdav.123pan.cn/webdav`
- 123 云盘使用独立的 `pan123Account` / `pan123Password`，不读取或不改写通用 WebDAV 的 `webdavUrl` / `webdavAccount` / `webdavPassword`
- 设置页新增独立「123 云盘」面板、固定地址展示、测试连接、保存并连接、断开并清除凭证
- 新增 `Pan123Adapter`（继承 `WebDavAdapter`），以及 123 云盘 provider/凭证隔离测试

### Changed

- manifest 描述、popup、README、安装/设计/隐私/自检文档补充通用 WebDAV 与 123 云盘
- 设置页存储服务从三选一改为四选一，123 云盘与原有三套面板互斥
- 未发布版本，`APP_VERSION` 与 `manifest.version` 仍为 `0.2.0`

### Security

- 通用 WebDAV 仅支持 Basic Auth；HTTP 地址会在 UI 中提示只建议在可信局域网使用
- 123 云盘仅访问固定 HTTPS 入口，使用第三方挂载应用密码而不是登录主密码
- 不申请安装时的全站权限，只按用户填写的域名或固定 123 域名请求可选主机权限
- 通用 WebDAV 与 123 云盘凭证只保存在本机 `chrome.storage.local`，不会写入日志或快照

### Verification

- `npm run typecheck` 通过
- `npm test` 通过（38 项）
- `npm run build` 通过
- 真实通用 WebDAV / 123 云盘服务器联调待完成（需要可用服务器、VIP 账号与凭证）

## [0.2.0] - 2026-11-27

### Added

- 新增 Microsoft OneDrive 存储后端，使用个人 Microsoft 账号
- OneDrive 采用 OAuth 2.0 设备代码流登录，不需要 redirect URI，不依赖扩展 ID
- 通过 Microsoft Graph `special/approot` 访问应用专属文件夹 `Apps/UDaSync/`
- 设置页新增「存储服务」切换、OneDrive client ID 输入、设备代码展示/复制/轮询与断开
- 新增 `gzip` 共用工具、存储适配器工厂，同步引擎改为 provider 无关
- 新增 OneDrive Graph 路径、读写、401 刷新与设备代码认证单元测试

### Changed

- 云端目录结构保持 `devices/` 与 `backups/`，坚果云与 OneDrive 共用同步内核
- 版本号从 `0.1.0` 升到 `0.2.0`；popup 与 manifest 同步更新
- README、安装说明、设计文档与隐私说明补充 OneDrive

### Security

- OneDrive 只申请 `Files.ReadWrite.AppFolder` + `User.Read` + `offline_access`
- 不申请 `Files.ReadWrite.All`，扩展无法读取应用专属文件夹之外的内容
- 新增 `graph.microsoft.com`、`login.microsoftonline.com`、`*.1drv.com`、`*.sharepoint.com` host permissions
- client ID 是公开标识；仓库不包含 client secret、token 或账号凭证

### Verification

- `npm run typecheck` 通过
- `npm test` 通过（27 项）
- `npm run build` 通过
- 真实 OneDrive 账号联调待完成（需要用户提供 Entra client ID）

[0.2.0]: https://github.com/UDaLink/UDaSync/releases/tag/v0.2.0

## [0.1.0] - 2026-11-26

### Added

- 基于坚果云 WebDAV 的多设备书签同步，支持 Chrome 与 Edge（Manifest V3）
- 整棵书签树同步，保留文件夹层级与顺序
- 三向合并、墓碑删除传播（30 天）、同名文件夹去重、后写赢冲突策略
- 首次绑定合并预览 + 本机原树 `[本机备份]` 文件夹
- 云端快照备份（最多 10 份）与回收站（7 天 / 300 条）
- 事件驱动 5 秒防抖、启动拉取、10 分钟轮询、手动同步与暂停
- 请求预算与坚果云 503 退避，结构化日志与状态角标
- 本机书签异常清空保护，避免误删云端数据
- 单元测试 20 项与真实 WebDAV 双实例端到端测试

### Security

- 仓库与构建产物不包含账号、应用密码或 token
- 凭证仅保存在本机 `chrome.storage.local`

[0.1.0]: https://github.com/UDaLink/UDaSync/releases/tag/v0.1.0
