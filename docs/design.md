# UDaSync 设计说明

## 1. 目标与非目标

**目标**

- Chrome / Edge（Manifest V3）共用一套代码，同步整棵书签树，保留文件夹层级与顺序
- 支持两种存储：坚果云 WebDAV 与个人 Microsoft OneDrive（Graph 应用专属文件夹）
- 多设备自动合并：新增、改名、移动、删除均传播；冲突后写赢；误删可恢复
- 首次绑定安全：先预览后写盘，并保留本机原树备份
- 失败可诊断：结构化日志、状态角标、失败通知

**非目标（v1）**

- 团队共享书签、权限管理
- favicon、书签访问统计、浏览器自带同步的替代品

## 2. 总体架构

```
┌─────────────┐   chrome.runtime   ┌──────────────────────────────┐
│ popup /     │ ───── messages ───▶│ background (Service Worker)  │
│ options UI  │◀──── {ok,data} ────│  ├─ sync-engine  同步编排    │
└─────────────┘                    │  ├─ scheduler    防抖/轮询   │
                                   │  └─ message router          │
                                   └───────┬──────────────┬───────┘
                                           │              │
                                  chrome.bookmarks   StorageAdapter
                                           │              │
                                     本地书签树      坚果云 WebDAV / OneDrive Graph
```

分层原则：

- `src/core` 纯函数，不触碰浏览器 API，便于单测（书签 API 以 `ApplyApi` 接口注入）
- `src/platform` 只做浏览器能力封装（书签、存储、日志、角标）
- `src/adapters` 只关心远端读写协议，向上暴露统一 `StorageAdapter`
- `src/background` 负责编排：读本地 → 拉远端 → 合并 → 落盘 → 上传

## 3. 数据模型

同步的身份不是 Chrome 的书签 id（换机/重装会变），而是扩展分配的稳定 UUID。

```ts
type BookmarkNode = {
  id: string;            // 稳定 UUID；根为 r:0/r:1/r:2/r:3
  parentId: string | null;
  kind: 'folder' | 'bookmark';
  title: string;
  url?: string;
  index: number;         // 同级顺序
  createdAt: number;
  updatedAt: number;     // 内容指纹变化时才推进
  deletedAt?: number;    // 墓碑
};
```

- 根节点按 `getTree` 根下的顺序映射：第 1 个 → `r:1`（书签栏）、第 2 个 → `r:2`（其他书签）、第 3 个 → `r:3`（移动端书签），根自身为 `r:0`
- 不同 profile 的根节点 id 不一定是 `1/2/3`（导入过书签的配置会变化），因此模型与落盘都在运行时读取真实 id，不硬编码
- `meta[uuid] = { createdAt, updatedAt, hash }`，`hash` 由 `title|url|parentId|index|kind` 计算；只有指纹变化才推进 `updatedAt`，避免"同步→时间戳变化→再同步"的回声
- Chrome id ↔ UUID 双向映射存 `ids`，删除后保留墓碑，重建时靠 `adoptOrphans` 吸附

## 4. 云端布局

坚果云：

```
/dav/UDaSync/
├─ devices/
│  ├─ <deviceId>.json.gz     # 每台设备一份快照（含墓碑）
│  └─ ...
└─ backups/
   └─ 2026-11-26T14-30-00-000Z.json.gz   # 最多保留 10 份
```

OneDrive（Graph 应用专属文件夹）：

```
/me/drive/special/approot:/UDaSync/
├─ devices/<deviceId>.json.gz
└─ backups/<时间戳>.json.gz
```

两种存储的目录结构、快照格式完全一致，切换 provider 时同步引擎不需要改合并逻辑。

快照结构：

```ts
type Snapshot = {
  schema: 1;
  deviceId: string;
  deviceName: string;
  generatedAt: number;
  nodes: BookmarkNode[];   // 存活节点 + 未过期墓碑
};
```

- 每台设备只写自己的文件，避免并发写同一文件；合并发生在客户端
- 读取时枚举 `devices/` 全部快照参与合并
- 快照 gzip 压缩后 PUT；`fingerprintNodes` 相同则跳过上传（`uploadHash`）
- 备份在"有变更"时写入，最小间隔 5 分钟，保留 10 份（按文件名时间倒序清理）

> 坚果云只接受真实 UTF-8 路径：浏览器发出的百分号编码路径（`%E6%88%91...`）会 404。因此目录必须是纯 ASCII，默认 `/dav/UDaSync/`。

## 5. 同步流程

```
1  连通性检查 + 确保 devices/ 目录存在
2  读本地树 → buildModel（分配 UUID、算指纹、检测本地删除→墓碑）
3  枚举并读取全部设备快照
4  adoptOrphans：重装/换机后用"同父+同名+同 URL"吸附本地新 id
5  mergeNodes：本地模型 + 所有远端快照 → 目标树
6  summarizeDiff：create/update/move/reorder/remove 统计
7  首次（云端已有数据且本机未确认）→ 只返回预览，等待用户确认
8  首次写盘前：把本机原树复制为 [本机备份] 文件夹（标题前缀过滤，永不参与同步）
9  云端备份（有变更且距上次 ≥5 分钟）
10 applyTarget：按依赖顺序落盘
11 合并墓碑表并回写本地；回收站入队
12 上传本机快照（哈希未变则跳过）
13 更新状态、角标、通知
```

### 5.1 合并规则

对每个 UUID 收集所有副本，取 `revision = max(updatedAt, deletedAt)`：

| 情况 | 结果 |
| --- | --- |
| 只有存活副本 | 保留，取 revision 最大的字段 |
| 只有墓碑 | 删除 |
| 存活 vs 墓碑 | revision 大者胜；相等时墓碑优先（防止误删复活） |
| 同父同名文件夹 | 只留 `createdAt` 最早者，其余标墓碑，子节点改挂到幸存者 |
| 父节点已删 | 子节点级联墓碑 |
| 兄弟顺序 | 按 `index` 排序后重编号，缺位补到末尾 |

删除传播依赖墓碑：墓碑在快照中保留 30 天（`TOMBSTONE_TTL_MS`），过期后不再上传，避免云端无限增长。

### 5.2 落盘顺序（`applyTarget`）

必须按依赖顺序，否则 Chrome 会拒绝或产生错位：

1. **创建**：父先子后（按深度排序）
2. **更新**：标题 / URL
3. **移动**：先搬"幸存子节点"，再搬待移动节点，避免父目录被移走时子节点丢失
4. **排序**：同级按目标 index 重排
5. **删除**：最后执行，自顶向下（先删父再删子，减少 API 调用）

落盘前写 `applyLock`（60 秒），期间收到的事件不再触发同步，避免自己写盘触发自己。

### 5.3 异常清空保护

浏览器关闭自带书签同步、重置配置或误操作时，本机书签可能瞬间归零。若直接把「全部删除」当成用户意图上传，会把云端与其他设备一起清空。

- 判定：本机存活节点 ≤ 2 且云端存活节点 ≥ 20，且不是用户刚确认的首次合并
- 处理：立即停止本次同步，状态置为错误并记录明确日志，不上传、不落盘
- 放行：用户确认首次合并（`confirmedFirstRun`）时跳过保护，用于从云端恢复
- 恢复：云端快照、`[本机备份]` 文件夹、导出的 HTML 三者任一都可作为恢复源

### 5.4 冲突示例

- A 改名 `GitHub → GitHub-A`，B 改名 `GitHub → GitHub-B`，B 更晚 → 最终 `GitHub-B`
- A 删除、B 移动同一节点：删除的 revision 更大则删除，否则按移动处理
- 同名文件夹两端各自新建：保留创建更早的，另一个的子节点迁移过来

## 6. 触发与调度

| 触发 | 说明 |
| --- | --- |
| 书签事件 | `onCreated/onChanged/onMoved/onRemoved/onChildrenReordered/onImport` → 5 秒防抖 |
| 启动 | `onStartup/onInstalled` 拉取一次 |
| 轮询 | `chrome.alarms` 每 10 分钟 |
| 手动 | popup「立即同步」/ 设置页按钮 |

- 同一时刻只允许一个同步（`inFlight`），重复请求返回"同步正在进行中"
- 连续失败 3 次发系统通知；角标用颜色表达 syncing/ok/error/paused
- 暂停只影响自动触发，手动同步仍可用

## 7. 限额与退避

坚果云免费版：600 请求 / 30 分钟。扩展在本地记录请求时间窗，超过 **450 次/30 分钟** 即进入退避：

- 退避期间自动触发直接跳过，状态置 `error` 并提示"请求过于频繁"
- 单次同步的请求数约为：1 PROPFIND（ping）+ 1 PROPFIND（devices）+ N GET（设备数）+ 1 PUT（本机）+ 可选 1 PUT（备份）+ 可选备份清理
- 轮询 10 分钟 ≈ 每 30 分钟 3 轮，正常使用远低于预算

## 8. 错误处理

- 网络 / 401 / 403 / 429 / 5xx 统一包装为 `WebDavError`，日志含方法与状态码
- 401 明确提示"账号或应用密码不正确"
- 403（目录删除）不重试：坚果云不允许递归删除目录，清理时逐文件 DELETE
- 落盘部分失败：记录已完成的 apply 步骤，下一次同步按 diff 继续收敛（幂等）
- 快照解析失败：跳过该设备并告警，不阻塞其他设备

## 9. 存储适配层

```ts
interface StorageAdapter {
  ping(): Promise<void>;
  ensureDir(path: string): Promise<void>;
  list(path: string): Promise<Entry[]>;
  readJson<T>(path: string): Promise<T>;
  writeJson(path: string, data: unknown): Promise<void>;
  remove(path: string): Promise<void>;
}
```

- `src/adapters/jianguoyun.ts`：WebDAV + 坚果云请求预算
- `src/adapters/onedrive.ts`：Microsoft Graph
- `src/adapters/onedrive-auth.ts`：OAuth 设备代码流与 token 刷新
- `src/adapters/factory.ts`：按 `config.provider` 构造对应适配器
- `src/background/sync-engine.ts` 只依赖 `StorageAdapter`，设备快照、备份、恢复都不再绑定坚果云

OneDrive Graph：

- 目录：`/me/drive/special/approot:/UDaSync`
- 上传：`PUT /me/drive/special/approot:/UDaSync/devices/<id>.json.gz:/content`
- 列表：`GET /me/drive/special/approot:/UDaSync/devices:/children`
- 下载：`GET ...:/content`，跟随 302 到 `*.1drv.com` 预签名地址
- 认证：OAuth2 **设备代码流**，`https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode` 与 `/token`
- Scope：`offline_access Files.ReadWrite.AppFolder User.Read`
- `Files.ReadWrite.AppFolder` 只能访问应用专属文件夹，不申请 `Files.ReadWrite.All`
- 设备代码流不需要 redirect URI，因此不受“加载已解压扩展”时扩展 ID 随目录变化的影响；代价是用户需要在 Microsoft 页面输入一次代码
- token 过期用 refresh token 自动刷新；刷新后的 token 由 `onTokens` 回写 `chrome.storage.local`
- 401 强制刷新一次；429 按 `Retry-After` 退避；5xx 重试一次

界面层的「存储服务」选择器在设置页；`provider` 存在 `UdasynConfig`，默认 `jianguoyun`。

## 10. 安全模型

- 凭证只存 `chrome.storage.local`：坚果云用 Basic Auth；OneDrive 只存 refresh token / access token
- 不向任何第三方域名发请求；`host_permissions` 仅坚果云 WebDAV、Microsoft Graph/登录、OneDrive 下载域名
- OneDrive 只申请 `Files.ReadWrite.AppFolder`，看不到应用专属文件夹之外的内容
- 扩展无 content script，不读取网页内容
- 建议为坚果云单独生成应用密码（可随时吊销），不要使用登录密码
- 若设备共用，依赖操作系统账户隔离；v2 可加本地口令（PBKDF2 + AES-GCM）

## 11. 目录与命名约定

- 源码按"共享 → 内核 → 适配 → 平台 → 编排 → 界面"单向依赖，禁止反向引用
- 所有跨层类型集中在 `src/shared/types.ts`
- UI 不直接访问 WebDAV，一律通过消息与后台通信；响应统一 `{ok, data?, error?}`
- 常量集中在 `src/shared/constants.ts`，禁止散落魔法数字
