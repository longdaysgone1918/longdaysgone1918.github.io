# 点赞和留言服务：部署说明 / Comments and likes service: deployment

这个文件夹不属于网站本身，只是保存部署在 Cloudflare 上的代码，方便以后查看和修改。里面没有任何密码或密钥。
This folder is not part of the website build; it keeps the code deployed on Cloudflare. It contains no passwords or keys.

| 文件 / File | 用途 / Purpose |
|---|---|
| `worker.js` | Worker 的全部代码，粘贴到 Cloudflare 的在线编辑器里 / the whole Worker, pasted into Cloudflare's editor |
| `schema.sql` | 数据库结构，在 D1 控制台里运行一次 / database schema, run once in the D1 console |

以下步骤都在 Cloudflare 后台（dash.cloudflare.com）完成。界面文字可能和这里略有不同，按意思找即可。

## 1. 人机验证 Turnstile

1. 左侧菜单找到 **Turnstile**，点 **添加小组件 (Add widget)**。
2. 名称填 `tianranl comments`；域名 (Hostnames) 添加 `tianranl.com` 和 `www.tianranl.com`。想在本地预览时测试留言，可以临时再加 `localhost`，测试完删掉。
3. 模式选 **托管 (Managed)**，创建。
4. 记下两个值：**Site Key**（公开的，填进网站）和 **Secret Key**（保密的，填进 Worker）。

## 2. 数据库 D1

1. 左侧菜单 **存储和数据库 (Storage & Databases) → D1**，点 **创建 (Create)**，名称填 `tianranl-comments`。
2. 打开这个数据库，切到 **控制台 (Console)**，把 `schema.sql` 的全部内容粘贴进去，点 **执行 (Execute)**。
   如果提示一次只能运行一条语句，就把每条 `CREATE …;` 分开逐条运行。

## 3. Worker

1. 左侧菜单 **Workers 和 Pages → 创建 (Create) → 创建 Worker**，从 "Hello World" 开始，名称填 `tianranl-comments`，点 **部署 (Deploy)**。
2. 打开这个 Worker，点 **编辑代码 (Edit code)**，删掉编辑器里原有的代码，粘贴 `worker.js` 的全部内容，点 **部署 (Deploy)**。
3. **绑定数据库**：Worker 页面 → **绑定 (Bindings) → 添加绑定 (Add binding) → D1 数据库**，变量名填 `DB`（大写），选择 `tianranl-comments`。
4. **添加密钥**：**设置 (Settings) → 变量和机密 (Variables and secrets) → 添加 (Add)**，类型选 **机密 (Secret)**，添加三个：
   - `ADMIN_PASSWORD`：管理页面的密码，用一个长一点、别处没用过的密码。
   - `TURNSTILE_SECRET`：第 1 步的 Secret Key。
   - `IP_SALT`：任意一长串随机字符。可以在 PowerShell 里运行 `[guid]::NewGuid().ToString()` 生成一个。
   - `NOTIFY_EMAIL` 和 `NTFY_TOKEN`（可选，推荐）：新留言的邮件通知，见第 5 步。
5. **自定义域名**：**设置 → 域和路由 (Domains & Routes) → 添加 (Add) → 自定义域 (Custom domain)**，填 `comments.tianranl.com`。Cloudflare 会自动添加需要的 DNS 记录。
6. **检查**：浏览器打开 `https://comments.tianranl.com/`，应该显示 `ok`；打开 `https://comments.tianranl.com/admin`，用 `ADMIN_PASSWORD` 登录，应该显示"没有留言"。

## 4. 网站

打开 `src/components/Comments.astro`，在文件顶部填两项，保存后提交推送：

```
const API_BASE = 'https://comments.tianranl.com';
const TURNSTILE_SITE_KEY = '第 1 步的 Site Key';
```

## 5. 新留言的邮件通知（推荐）

有新留言时，你的邮箱会收到一封邮件（由 ntfy 发出），内容包括昵称、留言、文章链接，以及两个链接：
已经显示的留言是"一键隐藏"，等待审核的是"一键通过"，点一下就生效，不用登录管理页面。这两个链接只对那一条留言有效。

1. 打开 `https://ntfy.sh`，免费注册一个账号（Sign up）。
2. 登录后进入 **账号 (Account) → 访问令牌 (Access tokens)**，创建一个令牌，复制下来（以 `tk_` 开头）。
   注册和令牌不是必须的，但强烈建议：Cloudflare 的 Worker 和很多别人的程序共用对外的网络地址，
   不用令牌时，ntfy 按网络地址计算发送数量，可能因为别人用得多而暂时拒绝发送；用了令牌就按你自己的账号计算。
3. 在 Worker 的 **变量和机密** 里添加两个机密：
   - `NOTIFY_EMAIL`：接收通知的邮箱地址，以后换邮箱只要改这里。
   - `NTFY_TOKEN`：上一步的令牌。
4. 在网站上留一条言试试。几分钟内应该收到邮件；没收到就看看垃圾邮件文件夹。
5. 管理页面顶部会显示"最近一次通知：成功/失败"。如果一直失败，或者每天的邮件数量不够用
   （ntfy 免费账号每天能发的邮件有上限，具体数字见 ntfy 官网），可以改用 Cloudflare 自己发邮件，到时再调整。

想同时收到手机推送：在 ntfy 应用里订阅同一个主题即可。主题名可以自己设（机密 `NTFY_TOPIC`），不设时自动生成。

## 审核方式

在 `worker.js` 开头的 `CONFIG` 里：

- `MODERATION: 'auto'`（默认）：新留言直接显示；含链接的留言，或含 `BLOCKED_WORDS` 里的词的留言，先等你审核。
- `MODERATION: 'review'`：所有留言都要审核后才显示。
- `BLOCKED_WORDS`：遇到某类垃圾留言时，把其中的词加进去，例如 `['casino', '代开发票']`。

## 以后修改 Worker

改了 `worker.js`（例如调整开头 CONFIG 里的数量限制），就重复第 3 步的第 2 步：在 Cloudflare 的编辑器里粘贴新代码并部署。仓库里的这份也同步改好、提交，保持两边一致。
