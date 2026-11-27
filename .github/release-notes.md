## UDaSync v0.2.0

用坚果云 WebDAV 或 Microsoft OneDrive 在多台电脑、多个 Chromium 浏览器之间同步书签。数据只存放在你自己的云盘里，不经过任何第三方服务器。

### 新增

- **OneDrive 存储后端**：面向个人 Microsoft 账号，通过 Microsoft Graph 访问应用专属文件夹 `Apps/UDaSync/`
- 设置页新增「存储服务」切换、OneDrive client ID、一次性设备代码登录、断开连接
- OneDrive 使用 OAuth 2.0 设备代码流，不需要 redirect URI，不依赖扩展 ID
- 只申请 `Files.ReadWrite.AppFolder` + `User.Read`，无法读取应用专属文件夹之外的文件
- 坚果云与 OneDrive 共用同一套同步内核、`devices/` 与 `backups/` 目录结构

### 主要能力

- 同步整棵书签树（书签栏 / 其他书签 / 移动端书签），保留文件夹层级与顺序
- 多设备增量合并：新增、改名、移动、删除都会传播
- 删除走墓碑机制（云端保留 30 天），不会被旧设备「复活」
- 冲突后写赢（按修改时间），误删可从回收站恢复
- 首次绑定先预览再写盘，并备份本机原树为 `[本机备份]` 文件夹
- 云端保留最近 10 份快照备份，可一键回滚
- 事件驱动 5 秒防抖 + 启动拉取 + 每 10 分钟轮询 + 手动同步
- 本机书签被浏览器异常清空时自动停止上传，保护云端数据

### 安装

1. 下载下方的 `UDaSync-0.2.0.zip` 并解压到一个固定目录
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启开发者模式
3. 点击「加载已解压的扩展程序」，选择解压后的目录
4. 打开扩展设置，选择坚果云或 OneDrive 并连接

OneDrive 需要先注册一个 Entra 应用并填写 Application (client) ID；个人 Microsoft 账号默认不能直接在 Microsoft Services 占位租户注册应用，具体步骤见仓库中的 `docs/onedrive-setup.md`。

### 安全

- 仓库不包含任何账号、应用密码、client secret 或 token
- 坚果云凭证只保存在本机 `chrome.storage.local`，仅用于 WebDAV 请求
- OneDrive 只保存 refresh token；client ID 是公开标识，不是密钥
- 建议使用单独生成的应用密码，并定期在坚果云后台吊销

### 已知限制

- OneDrive 真实账号联调需要用户自己的 Entra client ID；首次连接需要打开 Microsoft 登录页输入一次性代码
- OneDrive 自动化真实账号 E2E 尚未接入 CI，当前由手动验收覆盖
