# cf-pages-shortlink

一个可以直接部署到 **Cloudflare Pages** 的短链服务：静态前端 + Pages Functions + Workers KV，无构建步骤、无需服务器。

- 前端：`public/`（原生 HTML/CSS/JS，Pages 直接托管）
- 后端：`functions/`（Pages Functions，TypeScript，按文件路径自动生成路由）
- 存储：Workers KV（键 `link:<code>`，带 TTL）
- 管理接口用 `ADMIN_TOKEN` 保护，令牌只存在浏览器 localStorage

## 目录结构

```
cf-pages-shortlink/
├─ public/                  # 静态资源（构建输出目录）
│  ├─ index.html            # 控制台页面
│  ├─ styles.css
│  ├─ app.js
│  └─ _headers              # 静态资源安全响应头
├─ functions/
│  ├─ _lib/                 # 以下划线开头，不参与路由
│  │  ├─ types.ts
│  │  ├─ http.ts            # JSON / CORS / 鉴权
│  │  └─ links.ts           # KV 读写、短码与 URL 校验
│  ├─ api/
│  │  ├─ health.ts          # GET  /api/health
│  │  ├─ links.ts           # GET/POST /api/links
│  │  └─ links/[code].ts    # GET/DELETE /api/links/:code
│  └─ s/[code].ts           # GET  /s/:code  → 302 跳转
├─ wrangler.toml            # Pages 项目配置（KV 绑定、变量）
├─ .dev.vars.example        # 本地环境变量模板
├─ package.json
└─ tsconfig.json
```

## 变量与绑定

| 名称 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `LINKS` | KV 命名空间绑定 | 是 | — | 短链数据存储，绑定名必须叫 `LINKS` |
| `ADMIN_TOKEN` | Secret | 是 | — | 管理接口令牌。**必须是 Secret，不要写进 `wrangler.toml`** |
| `BASE_URL` | 变量 | 否 | 空（用请求域名） | 生成 `shortUrl` 用的站点地址，如 `https://s.example.com` |
| `ALLOW_ORIGIN` | 变量 | 否 | `*` | API 的 CORS 来源，生产建议改成你的域名 |
| `MAX_LINKS` | 变量 | 否 | `1000` | 最多保存条数，`0` = 不限制 |
| `COUNT_HITS` | 变量 | 否 | `1` | 是否统计点击，`0` = 关闭（省 KV 写入次数） |

本地开发时这些值放在 `.dev.vars`（已在 `.gitignore` 里，不会提交）。

## 方法一：本地运行

需要 **Node.js 20+**（wrangler 4 的最低要求，建议装 LTS）。安装后：

```powershell
cd cf-pages-shortlink
npm install

# 登录 Cloudflare（会打开浏览器）
npx wrangler login

# 创建 KV 命名空间，输出里的 id 填到 wrangler.toml
npx wrangler kv namespace create LINKS

# 生成一个随机令牌（PowerShell）
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

# 复制变量模板并填入上面生成的令牌
Copy-Item .dev.vars.example .dev.vars
```

把 `wrangler.toml` 里的 `REPLACE_WITH_KV_NAMESPACE_ID` 换成上一步返回的 `id`（不换也能本地跑，本地用的是模拟 KV）。

```powershell
npm run dev
```

如果提示找不到输出目录，改成显式指定：`npx wrangler pages dev public`。

打开 http://127.0.0.1:8788 ，在页面第 1 步粘贴 `.dev.vars` 里的 `ADMIN_TOKEN` 并保存，即可创建短链。

## 方法二：CLI 部署（推荐）

```powershell
# 首次：创建 Pages 项目
npx wrangler pages project create cf-pages-shortlink --production-branch main

# 部署 public/ 与 functions/
npx wrangler pages deploy

# 设置生产环境令牌（按提示粘贴，不会写进代码）
npx wrangler pages secret put ADMIN_TOKEN --project-name cf-pages-shortlink

# 普通变量改 dashboard 的 Settings → Variables and Secrets，
# 或直接改 wrangler.toml 的 [vars] 后重新部署
```

`wrangler pages deploy` 会读取 `wrangler.toml` 的 `pages_build_output_dir` 和 `[[kv_namespaces]]`，自动把 KV 绑定建好。

部署完成后：

1. 访问 `https://cf-pages-shortlink.pages.dev/api/health`，确认
   `kvBound: true`、`adminTokenConfigured: true`
2. 把 `BASE_URL` 改成实际域名（自定义域名时尤其重要），重新部署
3. 打开首页，粘贴令牌，创建短链
4. 验证跳转：

```powershell
curl.exe -I https://cf-pages-shortlink.pages.dev/s/你的短码
# 期望：HTTP/2 302 + location: https://目标地址
```

## 方法三：Git 集成部署（Dashboard）

1. 把 `cf-pages-shortlink` 推到 GitHub/GitLab。
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**，选择仓库。
3. 构建设置：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：`public`
   - Root directory：仓库里的 `cf-pages-shortlink`（如果仓库根就是项目则留空）
4. **Settings → Functions → KV namespace bindings**：Variable name 填 `LINKS`，选择你创建的命名空间（生产 + 预览各选一个）。
5. **Settings → Variables and Secrets**：添加 `ADMIN_TOKEN`（类型选 **Secret**）、`BASE_URL`、`ALLOW_ORIGIN`、`MAX_LINKS`、`COUNT_HITS`。
6. 保存并重新部署。

> 建议只保留一处配置：用 `wrangler.toml` 就用 CLI；用 Dashboard 就删掉 `wrangler.toml` 里的绑定段，避免两处冲突（同名时 Dashboard 优先）。
>
> 注意：Dashboard 的拖拽上传（Direct Upload）只会包含 `public/` 静态文件，**不会上传 `functions/`**。带后端就必须用 CLI 或 Git 集成。

## API

除 `/api/health` 与 `/s/:code` 外都需要令牌：
`Authorization: Bearer <ADMIN_TOKEN>`（也支持 `?token=...`，不推荐用于生产）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回变量/绑定是否就绪 |
| GET | `/api/links?limit=100&cursor=` | 列出短链 |
| POST | `/api/links` | 新建：`{ "url": "...", "code": "可选", "ttlDays": 可选 }` |
| GET | `/api/links/:code` | 查询单条 |
| DELETE | `/api/links/:code` | 删除 |
| GET | `/s/:code` | 302 跳转 |

示例（PowerShell，`Invoke-RestMethod` 比 curl 更不容易踩引号坑）：

```powershell
$TOKEN = "你的 ADMIN_TOKEN"
$BASE  = "https://cf-pages-shortlink.pages.dev"
$headers = @{ Authorization = "Bearer $TOKEN" }

# 新建
$body = @{
  url     = "https://example.com/a/very/long/link"
  code    = "promo2026"
  ttlDays = 30
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BASE/api/links" -Headers $headers `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5

# 列表
Invoke-RestMethod -Uri "$BASE/api/links?limit=20" -Headers $headers | ConvertTo-Json -Depth 5

# 删除
Invoke-RestMethod -Method Delete -Uri "$BASE/api/links/promo2026" -Headers $headers
```

macOS / Linux：

```bash
TOKEN=你的令牌; BASE=https://cf-pages-shortlink.pages.dev

curl -sS -X POST "$BASE/api/links" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/a/very/long/link","code":"promo2026","ttlDays":30}'

curl -sS "$BASE/api/links?limit=20" -H "Authorization: Bearer $TOKEN"
curl -sS -X DELETE "$BASE/api/links/promo2026" -H "Authorization: Bearer $TOKEN"
```

## 实现说明与注意事项

- **短码**：自定义短码限 `A-Z a-z 0-9 _ -`，3–32 位；不填则随机生成 7 位（已去掉易混淆字符）。
- **URL 校验**：只放行 `http/https`，支持省略协议（自动补 `https://`）。
- **有效期**：`ttlDays` 最大 3650 天，KV 写入时设置 `expirationTtl`，过期后读不到即为失效。
- **点击计数**：跳转时异步 `waitUntil` 写回，属于最终一致，并发下会少记；`COUNT_HITS=0` 可彻底关闭写入。
- **KV 一致性**：KV 是全球最终一致（通常几十秒内同步），新建/删除后在别的边缘节点可能短暂看到旧数据。要求强一致请换 D1。
- **免费额度**（以 Cloudflare 当前文档为准）：Pages Functions 约 10 万请求/天；KV 免费版约 10 万读/天、1000 写/天、1 GB 存储。**每次跳转的计数写也会消耗写额度**，纯跳转场景建议 `COUNT_HITS=0`。
- **安全**：`ADMIN_TOKEN` 为空时所有管理接口一律 401，不会裸奔；令牌比较使用定长比较；`/s/:code` 带 `noindex` 与 `no-referrer`。
- **换成 D1**：把 `functions/_lib/links.ts` 里的 `findLink/saveLink` 改成 D1 查询即可，路由层不用动；D1 绑定在 `wrangler.toml` 加 `[[d1_databases]]`。
- **自定义域名**：Dashboard → 项目 → Custom domains 绑定后，把 `BASE_URL` 改成该域名并重新部署。
