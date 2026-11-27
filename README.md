# UDaSync

[![CI](https://github.com/UDaLink/UDaSync/actions/workflows/ci.yml/badge.svg)](https://github.com/UDaLink/UDaSync/actions/workflows/ci.yml)
[![Release](https://github.com/UDaLink/UDaSync/actions/workflows/release.yml/badge.svg)](https://github.com/UDaLink/UDaSync/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

用**坚果云 WebDAV**、**任意支持 Basic Auth 的通用 WebDAV**、**123 云盘** 或 **Microsoft OneDrive** 在多台电脑、多个 Chromium 浏览器之间同步书签。Chrome 与 Edge 共用同一份扩展代码，书签以 gzip 压缩快照的形式存放在你自己的云盘里，不经过任何第三方服务器。

- 四种存储服务任选其一：坚果云 WebDAV（账号 + 应用密码）、通用 WebDAV（自定义服务器地址 + 账号 + 应用密码）、123 云盘（固定 WebDAV 地址 + 第三方挂载账号/应用密码）或 OneDrive（个人 Microsoft 账号 + 一次性设备代码登录）
- 通用 WebDAV 可接 Nextcloud、Synology、InfiniCLOUD、Koofr 等支持 Basic Auth 的服务；123 云盘使用单独的预设方案，不与通用 WebDAV 共用配置
- OneDrive 数据只写入应用专属文件夹 `Apps/UDaSync/`，不读取、不修改你的其他 OneDrive 文件
- 同步整棵书签树：书签栏 / 其他书签 / 移动端书签，保留文件夹层级与顺序
- 多设备增量合并：新增、改名、移动、删除都会传播；删除用墓碑机制，不会被旧设备"复活"
- 冲突策略：后写赢（按修改时间），冲突不丢数据，误删可从回收站恢复
- 首次绑定先预览、再写盘，并自动把本机原树备份成 `[本机备份]` 文件夹（不参与同步）
- 云端保留最近 10 份快照备份，可一键回滚
- 事件驱动（书签变动 5 秒防抖）+ 启动拉取 + 每 10 分钟轮询 + 手动同步
- 本机书签被浏览器异常清空时自动停止上传，避免把「空书签」同步到所有设备
- 无自建服务端、无账号体系、无遥测

## 安装

### 直接安装（推荐）

1. 从 [Releases](https://github.com/UDaLink/UDaSync/releases) 下载最新的 `UDaSync-x.y.z.zip`
2. 解压到一个固定目录（扩展加载后不要移动或删除）
3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的目录
5. 打开扩展设置，在「存储服务」里四选一：
   - **坚果云**：在坚果云「账户信息 → 安全选项 → 添加应用」生成**应用密码**，填入账号与应用密码
   - **通用 WebDAV**：填入 WebDAV 根地址、账号与应用密码；首次测试/保存时浏览器会请求访问该服务器的权限。Nextcloud、Synology 等均可
   - **123 云盘**：在 123 云盘「工具中心 → 第三方挂载 → WebDAV 授权管理」添加应用，授权文件夹并选择「读写」，复制页面显示的**账号**与**应用密码**填入；WebDAV 属于 123 云盘 VIP 权益
   - **OneDrive**：先按 [docs/onedrive-setup.md](docs/onedrive-setup.md) 注册一个 Entra 应用，把 Application (client) ID 填进设置页，再点「连接 OneDrive」，按提示在 Microsoft 页面输入一次性代码

首次同步会先展示合并预览，确认后写入；本机原书签会自动备份到 `[本机备份] …` 文件夹。详细步骤与常见问题见 [docs/install.md](docs/install.md)。

> 建议关闭浏览器自带的书签同步（`chrome://settings/syncSetup`），避免两套同步互相覆盖。

### 从源码构建

```bash
npm ci
npm run build          # 产物在 dist/
```

然后在扩展管理页加载 `dist/`。

## 安全

- 仓库不包含任何账号、应用密码、OAuth token 或 client secret
- 坚果云、通用 WebDAV 与 123 云盘凭证只保存在本机 `chrome.storage.local`，仅用于对应服务器的 WebDAV 请求
- 通用 WebDAV 使用 `optional_host_permissions`，只在你点击「测试连接 / 保存并连接」时请求所填域名的访问权限；不会在安装时申请全站权限
- 123 云盘同样使用可选主机权限，测试/保存时只请求 `https://webdav.123pan.cn/*`；不会新增安装时的必选权限
- OneDrive 只在本机保存 access/refresh token，且只请求 `Files.ReadWrite.AppFolder`（应用专属文件夹）权限；不申请读取整个网盘的权限
- OneDrive 认证使用设备代码流，不需要重定向 URI，不依赖扩展 ID；client ID 是公开标识，不是密钥
- 建议使用单独生成的应用密码，可随时在服务商后台吊销
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
│  ├─ adapters/            # 存储适配层：WebDAV 客户端 / 坚果云 / 通用 WebDAV / 123 云盘 / OneDrive Graph + 认证 + 工厂
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
| `npm test` | 单元测试（合并、模型、差异、WebDAV 解析、provider 工厂、123 云盘凭证隔离、settings 隔离、OneDrive Graph 路径与认证） |
| `npm run test:e2e` | 双实例端到端测试，需要真实坚果云账号（见下） |

E2E 需要两个环境变量，**不要把凭证写进任何文件**：

```bash
export JGY_ACCOUNT='你的坚果云账号'
export JGY_PASSWORD='坚果云应用密码'
npm run test:e2e
```

可选：`JGY_BASE_URL`（默认 `https://dav.jianguoyun.com/dav/`）、`JGY_DIR`（默认 `UDaSync-E2E`）、`CHROME_BIN`（自定义 Chromium 可执行文件）。

OneDrive、通用 WebDAV 与 123 云盘目前没有自动化的真实账号 E2E：OneDrive 需要有效的 Entra client ID 与个人 Microsoft 账号，按 [docs/onedrive-setup.md](docs/onedrive-setup.md) 手动联调；通用 WebDAV 需要自行准备服务器与凭证；123 云盘需要 VIP 账号与第三方挂载应用密码。CI 只跑类型检查、单元测试和构建。

## 使用须知

- **云端目录固定为 ASCII**：坚果云只认真实 UTF-8 路径，浏览器发出的百分号编码路径会 404，因此默认目录为 `/dav/UDaSync/`，不要放到「我的坚果云」等中文目录下。通用 WebDAV、123 云盘与 OneDrive 同样使用 ASCII 目录 `UDaSync`；OneDrive 位于应用专属文件夹 `Apps/UDaSync/`，123 云盘位于你添加应用时授权的文件夹内。
- **通用 WebDAV 只保证 Basic Auth**：仅支持用户名 + 密码（或应用密码）的 WebDAV；只提供 Digest、OAuth 或私有签名的服务暂不支持。公网地址请用 HTTPS，HTTP 只建议在可信局域网使用。
- **通用 WebDAV 的权限按域名申请**：首次测试/保存时 Chrome 会弹出授权，只允许扩展访问你填写的那个主机；换服务器需要重新授权。
- **123 云盘使用固定入口**：扩展固定访问 `https://webdav.123pan.cn/webdav`，只读取 `pan123Account` / `pan123Password`，与通用 WebDAV 的地址/凭证完全隔离。首次测试/保存同样按域名请求权限。
- **123 云盘 WebDAV 是 VIP 权益**：需要在网页端「第三方挂载」添加应用，权限选「读写」，只读无法同步；123 云盘用户协议对长期高频自动化 WebDAV 调用有保留，使用前请确认条款。
- **坚果云免费版限额**：30 分钟内 600 次请求；扩展内置 450 次/30 分钟的本地预算，超限自动退避。单文件上限 500 MB，快照为 gzip 压缩，正常书签量远低于限制。
- **OneDrive 只访问应用专属文件夹**：权限是 `Files.ReadWrite.AppFolder` + `User.Read`，扩展看不到你网盘里的其他文件；断开后云端快照不会自动删除。
- **一台电脑一个浏览器配置文件算一台设备**：Chrome 与 Edge、同一浏览器的不同 profile 都会独立登记，可在设置页改名或移除。
- **同一账号不要和浏览器自带同步同时开启**，否则两边会反复覆盖。
- **关闭 Chrome 自带书签同步前先导出 HTML**：部分 Chrome 版本在关闭「书签」同步项时会清空本机书签（UDaSync 会拦截这种异常清空，但先备份更稳妥）。
- 凭证仅保存在本机 `chrome.storage.local`，不会上传到所选存储服务之外。
- 四套存储之间切换不会迁移数据：切到另一个 provider 后首次同步会重新预览；想迁移书签，先让当前服务完成一次同步，再切换。

## 后续计划

- 本地口令加密（v2 计划，当前依赖操作系统账户与浏览器配置隔离）
- 书签栏以外的偏好同步（如是否显示书签栏）
- OneDrive 自动化真实账号 E2E（当前只能手动联调）
- 通用 WebDAV 自动化真实服务器 E2E（当前只做单元测试与手动联调）
- 123 云盘自动化真实账号 E2E（需要 VIP 账号，当前只做单元测试与手动联调）

## 隐私

扩展不收集、不上报任何数据。权限用途与数据流向见 [docs/privacy.md](docs/privacy.md)。
