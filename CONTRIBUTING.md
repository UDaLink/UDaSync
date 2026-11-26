# 贡献指南

感谢你愿意改进 UDaSync。提交前请先确认：**任何凭证、账号、应用密码、token 都不得出现在代码、测试、文档、截图或 Issue 中。**

## 开发环境

- Node.js 22+
- Chrome / Edge 任意 Chromium 浏览器
- 可选：Chrome for Testing（用于命令行端到端测试）

```bash
npm ci
npm run typecheck
npm test
npm run build
```

构建产物在 `dist/`，在 `chrome://extensions` 里「加载已解压的扩展程序」选择该目录。

## 代码结构

- `src/shared`：常量与类型，不依赖浏览器 API
- `src/core`：纯函数同步内核，单元测试覆盖
- `src/adapters`：WebDAV / 存储适配层
- `src/platform`：书签、配置、日志、角标等浏览器能力封装
- `src/background`：MV3 Service Worker 与同步编排
- `ui/`：popup 与 options 页面

依赖方向：`shared → core → adapters → platform → background → ui`，不要反向引用。

## 测试

- 单元测试：`npm test`，新增合并、差异、模型逻辑时同步补测试
- 类型检查：`npm run typecheck`
- 端到端：`npm run test:e2e`，需要环境变量：

```bash
export JGY_ACCOUNT='你的坚果云账号'
export JGY_PASSWORD='坚果云应用密码'
npm run test:e2e
```

E2E 会在 `JGY_DIR`（默认 `UDaSync-E2E`）下读写测试快照，不会使用生产目录。凭证不要写入 `.env`、脚本或 CI 配置。

## 提交与 PR

- 一个 PR 只做一件事，说明动机、行为变化与验证方式
- 不提交 `dist/`、`node_modules/`、`release/`、日志或本地截图
- 涉及同步算法时，附上覆盖新增/删除/冲突场景的测试
- 界面变更请附截图，但截图里不能出现账号、应用密码或真实书签内容

## 许可证

贡献即表示同意以 [MIT License](LICENSE) 授权。
