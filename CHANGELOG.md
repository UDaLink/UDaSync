# Changelog

所有重要变更都记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
