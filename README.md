# Utopia_乌托邦P / 创作档案

为 B 站中文 Vocaloid P 主 Utopia_乌托邦P 定制的个人博客与内容管理系统。项目使用 Vue 3 + Vite 构建主站，以 Express 提供文章、二创资源和后台管理 API。

## 当前安全状态

截至 2026-09-28，安全路线图 3.1 至 3.5 已完成并通过生产验收；3.6 至 3.8 的代码、自动化测试和 CI 已完成，但生产服务器仍需部署当前 `main` 的干净构建后才能完成生产验收。状态与证据以 [SECURITY_ROADMAP.md](SECURITY_ROADMAP.md) 为准，生产发布步骤见 [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)。

当前生产部署不得作为 3.6 至 3.8 的基准：最近一次检查中 `/build-info.json` 标记为 `dirty: true`，记录的提交已不在当前 Git 历史中，且 `/api/bilibili/cache-stats` 仍返回 `404`。发布时必须使用可追溯到当前 Git 提交且 `dirty: false` 的构建产物。

## 功能

- 作品主页、文章归档、视频列表、动态展示与全文搜索
- Markdown 文章阅读，以及后台实时预览、草稿和发布管理
- Bilibili 视频与动态的服务端同步接口
- 二创资源展示、上传、下载和删除
- 桌面、平板和手机响应式管理界面
- WebP 响应式图片、非首屏延迟加载和前后台代码分包
- Argon2id 管理密码、HttpOnly 会话、CSRF 防护、上传类型限制和 100 MB 文件大小限制

## 技术栈

- Vue 3
- Vite
- Express
- Marked + DOMPurify
- Multer
- Lucide Vue

## 快速开始

需要 Node.js 24.21.x 和 npm 11.19.0。项目会校验工具链版本，并使用 Node.js 内置 Argon2id 密码哈希。

```bash
npm ci
npm run dev:full
```

开发地址：

- 主站：`http://127.0.0.1:5173/`
- 管理后台：`http://127.0.0.1:5173/admin`
- 开发环境管理密码：`utopia-dev`
- API 健康检查：`http://127.0.0.1:8787/api/health`

只启动某一部分时可以使用：

```bash
npm run dev       # Vite 前端
npm run server    # Express API
```

开发模式下 Vite 会将 `/api` 代理到 `127.0.0.1:8787`，因此后台管理功能需要 Express API 同时运行。上传目录禁止直接访问，资源只能通过受控下载接口获取。

## 环境变量

复制 `.env.example` 为 `.env`：

```dotenv
VITE_BILIBILI_SYNC_URL=/api/bilibili/feed
VITE_BILIBILI_SPACE_URL=https://space.bilibili.com/1858510441
NODE_ENV=production
APP_ORIGIN=https://www.utopiap.top,https://utopiap.top
ARTICLE_IMAGE_HOSTS=
ADMIN_PASSWORD_HASH=replace-with-output-of-npm-run-security-hash-password
ADMIN_SESSION_IDLE_MINUTES=30
ADMIN_SESSION_ABSOLUTE_HOURS=8
ADMIN_LOGIN_WINDOW_MINUTES=15
ADMIN_LOGIN_IP_LIMIT=10
ADMIN_LOGIN_ACCOUNT_LIMIT=30
ADMIN_LOGIN_BACKOFF_BASE_MS=500
ADMIN_LOGIN_BACKOFF_MAX_MS=30000
ADMIN_LOGIN_CONCURRENCY=2
ADMIN_WRITE_WINDOW_MINUTES=10
ADMIN_WRITE_LIMIT=60
ADMIN_WRITE_CONCURRENCY=2
UPLOAD_MAX_FILE_MB=100
UPLOAD_TOTAL_QUOTA_MB=1024
UPLOAD_WINDOW_MINUTES=60
UPLOAD_LIMIT=10
UPLOAD_CONCURRENCY=1
UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB=512
UPLOAD_ARCHIVE_MAX_FILES=1000
UPLOAD_ARCHIVE_MAX_DEPTH=10
UPLOAD_ARCHIVE_MAX_RATIO=100
APP_STORAGE_ROOT=/var/lib/vocaloid-producer-blog
UPLOAD_VIRUS_SCAN_COMMAND=clamscan
UPLOAD_VIRUS_SCAN_ARGS=["--no-summary"]
UPLOAD_SCAN_TIMEOUT_SECONDS=60
TRUST_PROXY_HOPS=1
SERVER_HEADERS_TIMEOUT_SECONDS=15
SERVER_REQUEST_TIMEOUT_SECONDS=120
PORT=8787
```

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | 管理密码的 Argon2id 哈希；生产环境必须设置，不能填写明文密码 |
| `APP_ORIGIN` | 允许发起管理写请求的 HTTPS Origin；不含路径，多个地址使用逗号分隔 |
| `ARTICLE_IMAGE_HOSTS` | 可选的文章远程封面 HTTPS 域名白名单，多个域名使用逗号分隔；站内 `/images/` 路径始终允许 |
| `ADMIN_SESSION_IDLE_MINUTES` | 管理会话空闲过期时间，默认 30 分钟 |
| `ADMIN_SESSION_ABSOLUTE_HOURS` | 管理会话绝对过期时间，默认 8 小时 |
| `ADMIN_LOGIN_WINDOW_MINUTES` | 登录限流统计窗口，默认 15 分钟 |
| `ADMIN_LOGIN_IP_LIMIT` | 单 IP 在统计窗口内允许的失败登录次数，默认 10 次 |
| `ADMIN_LOGIN_ACCOUNT_LIMIT` | 管理账户在统计窗口内允许的总失败次数，默认 30 次 |
| `ADMIN_LOGIN_BACKOFF_BASE_MS` | 登录失败指数退避的基础延迟，默认 500 毫秒 |
| `ADMIN_LOGIN_BACKOFF_MAX_MS` | 登录失败指数退避的最大延迟，默认 30000 毫秒 |
| `ADMIN_LOGIN_CONCURRENCY` | 同时执行的 Argon2id 密码验证数，默认 2 次 |
| `ADMIN_WRITE_WINDOW_MINUTES` | 管理写接口限流窗口，默认 10 分钟 |
| `ADMIN_WRITE_LIMIT` | 单会话在窗口内允许的管理写请求数，默认 60 次 |
| `ADMIN_WRITE_CONCURRENCY` | 单会话允许的并发写请求数，默认 2 个 |
| `APP_STORAGE_ROOT` | 可选的服务端存储根目录，必须位于 Web 根目录之外；默认使用 `server/` |
| `UPLOAD_MAX_FILE_MB` | 单个上传文件上限，默认 100 MB |
| `UPLOAD_TOTAL_QUOTA_MB` | 上传目录总容量上限，默认 1024 MB |
| `UPLOAD_WINDOW_MINUTES` | 上传限流统计窗口，默认 60 分钟 |
| `UPLOAD_LIMIT` | 管理账户在窗口内允许的上传次数，默认 10 次 |
| `UPLOAD_CONCURRENCY` | 管理账户允许的并发上传数，默认 1 个 |
| `UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB` | ZIP 解压后总大小上限，默认 512 MB |
| `UPLOAD_ARCHIVE_MAX_FILES` | ZIP 内文件数量上限，默认 1000 个 |
| `UPLOAD_ARCHIVE_MAX_DEPTH` | ZIP 内目录最大层级，默认 10 层 |
| `UPLOAD_ARCHIVE_MAX_RATIO` | ZIP 最大压缩比，默认 100 |
| `UPLOAD_VIRUS_SCAN_COMMAND` | 病毒扫描程序路径；推荐使用 `clamscan`，未配置时拒绝 ZIP、7Z 和 RAR |
| `UPLOAD_VIRUS_SCAN_ARGS` | 传给扫描程序的 JSON 字符串数组，文件路径会自动追加到末尾 |
| `UPLOAD_SCAN_TIMEOUT_SECONDS` | 单次病毒扫描超时，默认 60 秒 |
| `TRUST_PROXY_HOPS` | Express 信任的反向代理跳数；单层 Nginx 使用 `1` |
| `SERVER_HEADERS_TIMEOUT_SECONDS` | Node HTTP 服务器接收完整请求头的超时，默认 15 秒 |
| `SERVER_REQUEST_TIMEOUT_SECONDS` | Node HTTP 服务器处理完整请求的超时，默认 120 秒 |
| `PORT` | Express 服务端口，默认 `8787` |
| `NODE_ENV` | 设置为 `production` 时启用生产 Cookie 与缓存策略，并强制检查认证配置 |
| `VITE_BILIBILI_SYNC_URL` | 覆盖默认的同源 `/api/bilibili/feed` 聚合接口地址 |
| `VITE_BILIBILI_SPACE_URL` | 主站跳转到 Bilibili 个人空间的地址 |
| `BILIBILI_UID` | 服务端同步的 Bilibili 用户 UID，默认 `1858510441` |
| `BILIBILI_COOKIE` | 可选的服务端 Cookie，用于降低公开接口触发风控的概率 |
| `BILIBILI_UPSTREAM_TIMEOUT_SECONDS` | Bilibili 单次上游请求超时，默认 8 秒 |
| `BILIBILI_JSON_MAX_MB` | Bilibili JSON 上游响应上限，默认 2 MB |
| `BILIBILI_IMAGE_MAX_MB` | 单张代理图片响应上限，默认 5 MB |
| `BILIBILI_REDIRECT_LIMIT` | Bilibili 上游最大重定向次数，默认 3 次 |
| `BILIBILI_IMAGE_CACHE_MB` | 图片内存缓存总容量，默认 32 MB |
| `BILIBILI_IMAGE_CACHE_ENTRIES` | 图片内存缓存条目上限，默认 64 条 |
| `PUBLIC_RATE_WINDOW_MINUTES` | 公开接口限流窗口，默认 10 分钟 |
| `BILIBILI_FEED_RATE_LIMIT` | 单 IP 在窗口内允许的同步请求数，默认 60 次 |
| `BILIBILI_IMAGE_RATE_LIMIT` | 单 IP 在窗口内允许的图片代理请求数，默认 180 次 |
| `BILIBILI_FEED_CONCURRENCY` | 同步接口全局并发请求上限，默认 4 个 |
| `BILIBILI_IMAGE_CONCURRENCY` | 图片代理全局并发请求上限，默认 8 个 |
| `RESOURCE_DOWNLOAD_RATE_LIMIT` | 单 IP 在窗口内允许的资源下载请求数，默认 60 次 |
| `RESOURCE_DOWNLOAD_CONCURRENCY` | 资源下载全局并发请求上限，默认 4 个 |
| `RESOURCE_DOWNLOAD_MAX_MB` | 允许下载的单个资源大小上限，默认 100 MB |
| `RESOURCE_DOWNLOAD_TIMEOUT_SECONDS` | 单次资源下载最长时间，默认 120 秒 |

`VITE_` 开头的变量会在构建时进入前端代码，不能在其中保存 Cookie、Access Key 或签名密钥。

使用隐藏输入的交互命令生成 Argon2id 密码哈希，并将输出写入服务器 `.env`：

```bash
npm run security:hash-password
```

后台登录成功后只在浏览器中设置 `HttpOnly`、`SameSite=Strict` 会话 Cookie。前端不保存管理密码或长期令牌；写操作还需要匹配的 Origin 和 CSRF Token。会话默认空闲 30 分钟或登录 8 小时后失效，退出登录会立即吊销当前会话。

后台登录按 IP 和管理账户分别限流，连续失败会触发指数退避，同时限制 Argon2id 验证并发数。管理写接口按会话限制请求频率和并发数，JSON 请求体上限为 512 KB。安全日志使用单行 JSON，记录请求 ID、来源 IP、事件和结果，不记录密码、Cookie、CSRF Token 或 Authorization Header。

仓库提供敏感文件提交前检查。首次克隆后启用 Git Hook：

```bash
git config core.hooksPath .githooks
npm run security:secrets
```

## 内容管理

后台包含工作概览、文章管理和二创资源三个页面。

文章支持：

- 新建、编辑和删除
- Markdown 实时预览
- 保存草稿或公开发布
- 标题、分类、摘要、日期、阅读时间、封面和强调色设置

二创资源支持 MID、MIDI、WAV、MP3、FLAC、ZIP、7Z、RAR、PNG、JPG、JPEG、WebP、PDF、PSD 和 TXT。服务端会联合检查扩展名、浏览器 MIME 和文件签名，拒绝高风险双扩展名；ZIP 还会检查文件数、解压大小、压缩比、目录层级、嵌套压缩包、可执行文件、加密内容和符号链接。服务端不会自动解压上传的压缩包。

生产环境应安装并更新 ClamAV，将 `UPLOAD_VIRUS_SCAN_COMMAND` 设置为 `clamscan` 或其绝对路径。配置扫描器后，文件只有在同步扫描成功后才会写入公开资源列表；扫描器缺失或不可用时，ZIP、7Z 和 RAR 会默认拒绝。上传同时受到单文件大小、总容量、频率和并发限制。

后台文章元数据保存在 `server/data/content.json`，上传文件保存在 `server/uploads/`。草稿不会通过公开接口返回。文章和资源表单会按统一 Schema 校验类型、长度和枚举值，并拒绝未知字段。内容写入携带版本号；当其他页面已先完成保存时，旧页面会收到冲突提示并刷新列表，不会静默覆盖新内容。

## Markdown 文章

文章统一通过 `/admin` 后台使用 Markdown 编写，支持实时预览、草稿和发布。文章数据保存在 `server/data/content.json`，主站通过 `/api/content` 读取已发布内容，草稿不会公开显示。

Markdown 渲染结果会经过 DOMPurify 清理，主站和后台预览共用固定的标签、属性及 URL 协议白名单。文章封面仅接受站内 `/images/` 路径，或 `ARTICLE_IMAGE_HOSTS` 明确允许的 HTTPS 域名。API 不可用或没有已发布文章时，主站显示空状态。

## 二创资源

二创资源统一通过 `/admin` 后台上传。文件使用服务端随机名存放在 `server/uploads/`，元数据写入 `server/data/content.json`；也可以通过 `APP_STORAGE_ROOT` 将两者放入独立持久化目录。存储目录不提供静态访问，下载统一经过 `/api/resources/:id/download`，强制使用附件模式、`nosniff` 和 UTF-8 文件名。删除操作先隔离磁盘文件，再提交元数据并记录安全审计事件。没有资源时主站显示空状态。

## Bilibili 同步

主站默认读取同源 `/api/bilibili/feed`。Express 服务端通过 WBI 签名接口获取 `BILIBILI_UID` 对应的全部空间投稿，同时提取最近三条动态，并将结果缓存 10 分钟。视频封面通过同源 `/api/bilibili/image` 代理，按需获取 `960 x 540` WebP 缩略图，并使用受限的服务端内存缓存和浏览器长期缓存，避免 Bilibili 图片防盗链及原图过大导致加载缓慢。浏览器不会直接请求 Bilibili。

图片代理仅允许固定的 Bilibili 图片主机和 HTTPS 默认端口。服务端在每次重定向前重新验证 URL 与 DNS 解析结果，并将通过检查的公网地址固定到实际 TLS 请求，阻止私网、环回、链路本地、开放重定向及 DNS 重绑定。同步、图片和下载接口分别限制请求频率、全局并发、响应大小与超时；相同图片和同步请求会复用正在进行的上游请求。

`/api/bilibili/cache-stats` 提供不含敏感信息的缓存指标，包括命中、未命中、合并请求、淘汰次数、当前条目和内存占用。图片响应的 `X-Image-Cache` 与同步响应的 `X-Feed-Cache` 会返回 `HIT`、`MISS` 或 `COALESCED`。

Bilibili 可能对数据中心 IP 返回 `412` 风控页面。遇到这种情况，可以在 `.env` 的 `BILIBILI_COOKIE` 中配置有效的服务端 Cookie 后重启服务。该变量不能添加 `VITE_` 前缀，也不要提交到 Git。

接口响应格式：

```json
{
  "syncedAt": "2026-09-26T14:20:00+08:00",
  "videos": [
    {
      "id": "BV...",
      "title": "视频标题",
      "stats": "12.8万播放 · 902弹幕",
      "date": "2026-09-26",
      "cover": "https://i0.hdslb.com/...",
      "duration": "04:12"
    }
  ],
  "dynamics": [
    {
      "id": "动态 ID",
      "time": "2026-09-26",
      "text": "动态正文",
      "topic": "#话题"
    }
  ]
}
```

同步成功后，首页视频、视频档案和“此刻动态”都会使用真实内容。视频与动态分别通过 `videoUnavailable`、`dynamicUnavailable`、`videoStale` 和 `dynamicStale` 标记同步状态，单项失败不会影响另一项。页面不会使用本地示例视频或动态。

## 图片优化

将原始 JPG 图片放入 `public/images/` 后运行：

```bash
npm run optimize:images
```

脚本会生成 `640px` 和 `1600px` 两档 WebP。主站通过 `srcset` 为不同设备选择尺寸。

## 构建与部署

```bash
npm ci
npm run verify:reproducible
npm run verify:build
npm start
```

`npm ci` 严格按锁文件安装依赖。`npm run verify:reproducible` 连续构建两次并比较全部文件的 SHA-256，成功后在 `dist/` 留下生产产物。`dist/build-info.json` 记录完整 Git 提交 SHA 和构建时工作区状态；`npm run verify:build` 只接受来自当前提交且工作区干净的产物。`npm start` 启动 Express，并在同一端口提供 API、受控资源下载和构建后的单页应用。当前服务监听所有网卡的 `8787` 端口，生产环境必须通过云安全组和主机防火墙阻止公网直连。

生产构建必须从干净的 Git 检出执行。运行时数据应通过 `APP_STORAGE_ROOT` 放在仓库外，避免 `server/data/content.json` 的生产修改污染构建来源。发布预构建产物时，应将部署记录中的提交传给校验命令：

```bash
DEPLOY_COMMIT=完整的40位Git提交SHA npm run verify:build
```

生产环境要求：

- 设置 `NODE_ENV=production`、正确的 `APP_ORIGIN` 和 `ADMIN_PASSWORD_HASH`
- 使用 Nginx、Caddy 或其他反向代理提供 HTTPS、强制 CSP 和安全响应头
- 云安全组和主机防火墙禁止公网访问 Express 的 `PORT`
- 使用 `APP_STORAGE_ROOT` 将生产数据放在 Git 工作区之外，并独立备份
- 部署前验证 `dist/build-info.json`，部署后通过公开接口核对同一提交 SHA
- `main` 只允许通过 Pull Request 合并，并要求安全构建与 CodeQL 检查成功

不要只部署 `dist/`：纯静态部署可以浏览内置内容，但后台、动态文章和上传资源 API 将不可用。

### 反向代理示例

生产部署由 Express 同时提供 `dist`、SPA 回退和 API，Nginx 应将页面与 `/api/` 请求全部代理到 Express，不要再为同一站点增加独立的 `try_files ... /index.html` 回退。否则 API 路由可能错误返回 HTML，并在后台表现为 `Unexpected token '<'`。

完整的 Nginx 限流、TLS、安全响应头、CSP、systemd、发布和回滚配置见 [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)。下面只保留最小路由结构：

```nginx
location /api/admin/ {
    client_max_body_size 101m;
    proxy_pass http://127.0.0.1:8787;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
}

location /api/ {
    proxy_pass http://127.0.0.1:8787;
}

location /uploads/ {
    return 404;
}

location / {
    proxy_pass http://127.0.0.1:8787;
}
```

所有代理位置还必须传递 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`，并配置合理的连接与读取超时。后台出现 `Unexpected token '<'` 时，先检查 `/api/` 是否被 SPA 回退规则接管：

```bash
curl -i https://你的域名/api/health
```

正常响应的 `Content-Type` 应为 `application/json`，正文为 `{"ok":true}`。

### 生产发布门禁

每次生产发布至少完成以下检查：

```bash
git status --porcelain=v1
git rev-parse HEAD
npm ci
npm run security:supply-chain
npm audit --audit-level=high --registry=https://registry.npmjs.org
npm run security:secrets
npm run test:auth
npm run test:uploads
npm run test:public
npm run test:content
npm run verify:reproducible
npm run verify:build
```

第一条命令必须没有输出。服务重启后还要检查 `/build-info.json` 的 `commit` 与部署提交一致且 `dirty` 为 `false`，并验证 `/api/health`、`/api/bilibili/cache-stats`、后台登录和一次只读内容加载。不得从包含生产数据修改的 Git 工作区直接构建。

## 验证命令

```bash
npm run build          # 生产构建
npm run audit:ui       # 桌面、平板和手机界面审计
npm run test:auth      # 后台认证与限流集成测试
npm run test:uploads   # 上传、扫描、下载与删除安全集成测试
npm run test:public    # SSRF、重定向、响应上限和超时安全测试
npm run test:content   # 内容 Schema、版本冲突与 Markdown XSS 测试
npm run security:supply-chain # 精确版本、锁文件、许可证、弃用和来源检查
npm run verify:reproducible   # 双构建文件哈希一致性检查
npm run verify:build          # 构建产物 Git SHA 与工作区状态检查
npm run security:secrets
npm audit --audit-level=high --registry=https://registry.npmjs.org
npm run optimize:images
```

`audit:ui` 使用本机 Microsoft Edge，截图保存在 `.screenshots/`，并检查横向溢出、控制台错误、后台粘性导航和切页滚动位置。

## 供应链安全

项目固定 Node.js 主版本、npm 版本及所有直接依赖版本，并提交 npm v3 锁文件。`.npmrc` 固定使用官方 registry；已弃用的 `lucide-vue-next` 已替换为 `@lucide/vue`。许可证白名单、弃用标记、包来源和完整性字段由 `security:supply-chain` 检查。

GitHub Actions 对每次 `main` 推送和 Pull Request 执行 `npm ci`、完整依赖审计、敏感文件检查、全部安全测试、双构建一致性检查及构建来源验证。CodeQL 额外执行 JavaScript/TypeScript 扩展安全查询，Dependabot 每周检查 npm 依赖、每月检查 Actions。所有 Actions 均固定到完整提交 SHA。

在 GitHub 分支保护中要求所有修改通过 Pull Request，并将 `Security and reproducible build / verify` 和 `CodeQL / analyze` 设置为 `main` 的必需检查，使新增高危漏洞或静态分析失败直接阻止合并。CI 产物名称包含提交 SHA，并保留 14 天。Dependabot PR 不能自动视为安全升级，仍需检查破坏性变更、测试结果和对现有安全边界的影响。

## 项目结构

```text
public/                 静态图片等公开资源
scripts/                图片优化与界面审计脚本
server/
  data/content.json     后台文章和资源元数据
  uploads/              后台上传文件
  index.js              Express API 与生产静态服务
src/
  services/             后台 API 与 Bilibili 同步客户端
  AdminApp.vue          管理后台
  App.vue               主站
PRODUCTION_DEPLOYMENT.md 生产部署、安全验收与回滚手册
SECURITY_ROADMAP.md      安全阶段状态、证据与后续目标
```

## 开源协议

项目源代码采用 [MIT License](LICENSE) 开源，Copyright (c) 2026 Utopia_乌托邦P。

站点展示的音乐作品、封面和可下载二创素材不因源代码采用 MIT 协议而自动授权；相关内容仍以作者或对应权利人的单独说明为准。
