# OneDrive 接入准备（个人 Microsoft 账号）

UDaSync 的 OneDrive 模式面向**个人 Microsoft 账号**（outlook.com / hotmail.com / live.com 等），不要求 Microsoft 365 或企业账号。扩展只申请应用专属文件夹权限，数据写入 OneDrive 的 `Apps/UDaSync/`，不会读取你网盘里的其他文件。

## 1. 先理解一个前提：client ID 需要 Entra 租户

OneDrive 通过 Microsoft Graph 访问，需要一个 **Entra 应用注册**来获得 `client ID`。应用注册本身免费，但个人 Microsoft 账号默认落在 Microsoft 的 “Microsoft Services” 占位租户里，这个租户不能承载应用注册，直接打开 Entra 会报 `AADSTS16000`。所以需要先有一个自己的 Entra 租户来放应用注册。

目前个人可用的两条官方路径：

1. **Azure 免费账号**：用个人 Microsoft 账号在 Azure 门户注册免费账号，注册过程中会自动创建一个 Entra 租户，你成为该租户的全局管理员。注册可能要求验证手机号，部分情况下会要求添加付款方式；应用注册本身不产生费用。
2. **Microsoft 365 Business Basic 一个月试用**：用任意邮箱注册试用，会创建一个工作账号和全新租户。试用结束前取消订阅，租户和应用注册仍可留在免费 Entra 层。

> 个人账号不能直接把自己的 Microsoft 账号“升级”成租户；租户只是应用注册的容器。登录 OneDrive 时仍然用你自己的个人 Microsoft 账号，扩展走 `/consumers` 端点。

## 2. 创建应用注册

1. 用刚创建的租户管理员账号登录 [Microsoft Entra 管理中心](https://entra.microsoft.com)。
2. 左侧进入 **Entra ID → 应用注册 → 新注册**。
3. 名称填 `UDaSync`。
4. **支持的账户类型**选择 **仅个人 Microsoft 账户**（如果以后也想用企业账号，可选“任何组织目录中的账户和个人 Microsoft 账户”，但当前扩展的登录端点按个人账号设计）。
5. **重定向 URI** 留空。UDaSync 使用设备代码流，不需要重定向 URI，也不依赖扩展 ID。
6. 点击 **注册**，在概览页复制 **Application (client) ID**。这就是设置页要填的 client ID，它是公开标识，不是密码。

## 3. 打开 public client 并添加权限

1. 进入应用 → **身份验证** → 拉到下方 **高级设置**，把 **允许公共客户端流**（Allow public client flows / Enable the following mobile and desktop flows）设为 **是**，保存。
2. 进入 **API 权限** → **添加权限** → **Microsoft Graph** → **委托的权限**，添加：
   - `Files.ReadWrite.AppFolder`
   - `User.Read`
   - `offline_access`
3. 不需要“代表组织授予管理员同意”；个人账号首次登录时自行同意即可。
4. 不需要创建 client secret。设备代码流使用 public client，扩展只保存 refresh token。

## 4. 在 UDaSync 里连接

1. 打开扩展设置 →「存储服务」选择 **OneDrive**。
2. 粘贴上一步的 **Application (client) ID**。
3. 点击 **连接 OneDrive**。扩展会显示一个一次性代码，并打开 Microsoft 登录页；在登录页输入代码，用你的个人 Microsoft 账号登录并同意权限。
4. 授权成功后设置页会显示已连接账号，并自动执行首次同步；如果云端已有其他设备，会先显示合并预览。

## 5. 数据放在哪里

- Graph 路径：`/me/drive/special/approot:/UDaSync/`
- 在 OneDrive 里通常显示为 `应用 / UDaSync`（Apps/UDaSync），只包含：
  - `devices/<deviceId>.json.gz`
  - `backups/<时间戳>.json.gz`
- 扩展没有 `Files.ReadWrite.All` 权限，无法列出或修改这个文件夹之外的内容。
- 断开 OneDrive 只清除本机 token，不会删除云端快照；需要彻底清理时，在 OneDrive 里删除 `Apps/UDaSync` 文件夹。

## 6. 常见问题

**登录页提示应用未配置 / 不支持个人账号**

检查应用注册的“支持的账户类型”是否包含个人 Microsoft 账户，并确认扩展使用的是 `/consumers` 端点。

**提示 AADSTS50020 / AADSTS16000**

你还在 Microsoft Services 占位租户里，或者应用注册不在当前租户。先完成 Azure 免费账号 / M365 试用创建租户，再在租户里注册应用。

**授权后同步报 403**

检查 API 权限是否添加了 `Files.ReadWrite.AppFolder` 和 `User.Read`，并确认用户在同意页勾选了权限。修改权限后建议在设置页断开 OneDrive 再重新连接。

**设备代码过期**

代码通常 15 分钟有效。过期后重新点「连接 OneDrive」生成新代码；设置页关闭后本次登录也会中断，重新连接即可。

**换电脑需要重新注册应用吗**

不需要。client ID 可以复用；每台电脑在设置页填同一个 client ID，分别用自己的 Microsoft 账号授权。每台设备会生成独立 token。
