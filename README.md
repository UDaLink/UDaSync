# UDaSync

[![CI](https://github.com/UDaLink/UDaSync/actions/workflows/ci.yml/badge.svg)](https://github.com/UDaLink/UDaSync/actions/workflows/ci.yml)
[![Release](https://github.com/UDaLink/UDaSync/actions/workflows/release.yml/badge.svg)](https://github.com/UDaLink/UDaSync/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

用**坚果云 WebDAV** 在多台电脑、多个 Chromium 浏览器之间同步书签。Chrome 与 Edge 共用同一份扩展代码，书签以 gzip 压缩快照的形式存放在你自己的坚果云账号里，不经过任何第三方服务器。

- 同步整棵书签树：书签栏 / 其他书签 / 移动端书签，保留文件夹层级与顺序
- 多设备增量合并：新增、改名、移动、删除都会传播；删除用墓碑机制，不会被旧设备"复活"
- 冲突策略：后写赢（按修改时间），冲突不丢数据，误删可从回收站恢复
- 首次绑定先预览、再写盘，并自动把本机原树备份成 `[本机备份]` 文件夹（不参与同步）
- 云端保留最近 10 份快照备份，可一键回滚
- 事件驱动（书签变动 5 秒防抖）+ 启动拉取 + 每 10 分钟轮询 + 手动同步
- 本机书签被浏览器异常清空时自动停止上传，避免把「空书签」同步到所有设备
- 只使用坚果云官方 WebDAV 接口，无自建服务端、无账号体系、无遥测

## 安装

### 直接安装（推荐）

1. 从 [Releases](https://github.com/UDaLink/UDaSync/releases) 下载最新的 `UDaSync-x.y.z.zip`
2. 解压到一个固定目录（扩展加载后不要移动或删除）
3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的目录
5. 在坚果云「账户信息 → 安全选项 → 添加应用」生成**应用密码**，打开扩展设置填写账号并连接

首次同步会先展示合并预览，确认后写入；本机原书签会自动备份到 `[本机备份] …` 文件夹。详细步骤与常见问题见 [docs/install.md](docs/install.md)。

> 建议关闭浏览器自带的书签同步（`chrome://settings/syncSetup`），避免两套同步互相覆盖。

### 从源码构建

```bash
npm ci
npm run build          # 产物在 dist/
```

然后在扩展管理页加载 `dist/`。

## 安全

- 仓库不包含任何账号、应用密码或 token
- 凭证只保存在本机 `chrome.storage.local`，仅用于坚果云 WebDAV 请求
- 建议使用单独生成的应用密码，可随时在坚果云后台吊销
- E2E 测试只从环境变量读取凭证，不写入文件

## 目录结构

```
UDaSync/
├─ public/                 # 原样拷贝进 dist 的静态资源
│  ├─ manifest.json        # MV3 清单
│  └─ icons/               # 16/32/48/128/512 图标
├─ src/
│  ├─ shared/              # 常量与共享类型（无运行时依赖）
│  ├─ core/                # 纯函数同步内核：模型、合并、差异、落盘、备份
│  ├─ adapters/            # 存储适配层：WebDAV 客户端 + 坚果云实现 + 接口
│  ├─ platform/            # 浏览器能力封装：书签、配置、日志、角标
│  └─ background/          # MV3 Service Worker：消息路由与同步引擎
├─ ui/                     # popup 与 options 页面（原生 TS + CSS，无框架）
├─ tests/
│  ├─ *.test.ts            # Vitest 单元测试
│  └─ e2e/                 # 基于 CDP 的双浏览器实例端到端测试
├─ scripts/                # 构建清理与产物校验
├─ docs/                   # 设计、安装、自检、隐私说明
└─ .github/                # CI 与 Release 工作流
```

设计取舍与算法细节见 [docs/design.md](docs/design.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 清理 → 构建后台与界面 → 校验产物 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 单元测试（合并、模型、差异、WebDAV 解析） |
| `npm run test:e2e` | 双实例端到端测试，需要真实坚果云账号（见下） |

E2E 需要两个环境变量，**不要把凭证写进任何文件**：

```bash
export JGY_ACCOUNT='你的坚果云账号'
export JGY_PASSWORD='坚果云应用密码'
npm run test:e2e
```

可选：`JGY_BASE_URL`（默认 `https://dav.jianguoyun.com/dav/`）、`JGY_DIR`（默认 `UDaSync-E2E`）、`CHROME_BIN`（自定义 Chromium 可执行文件）。

## 使用须知

- **云端目录必须是纯 ASCII**：坚果云只认真实 UTF-8 路径，浏览器发出的百分号编码路径会 404，因此默认目录为 `/dav/UDaSync/`，不要放到「我的坚果云」等中文目录下。
- **免费版限额**：30 分钟内 600 次请求；扩展内置 450 次/30 分钟的本地预算，超限自动退避。单文件上限 500 MB，快照为 gzip 压缩，正常书签量远低于限制。
- **一台电脑一个浏览器配置文件算一台设备**：Chrome 与 Edge、同一浏览器的不同 profile 都会独立登记，可在设置页改名或移除。
- **同一账号不要和浏览器自带同步同时开启**，否则两边会反复覆盖。
- **关闭 Chrome 自带书签同步前先导出 HTML**：部分 Chrome 版本在关闭「书签」同步项时会清空本机书签（UDaSync 会拦截这种异常清空，但先备份更稳妥）。
- 凭证仅保存在本机 `chrome.storage.local`，不会上传到除坚果云 WebDAV 之外的任何地方。

## 后续计划

- OneDrive 存储适配（`StorageAdapter` 已预留，Graph API 走 `/me/drive/special/approot`）
- 本地口令加密（v2 计划，当前依赖操作系统账户与浏览器配置隔离）
- 书签栏以外的偏好同步（如是否显示书签栏）

## 隐私

扩展不收集、不上报任何数据。权限用途与数据流向见 [docs/privacy.md](docs/privacy.md)。
