# Changelog

所有重要变更都记录在此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
