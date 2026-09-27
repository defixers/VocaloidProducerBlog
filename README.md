# Utopia_乌托邦P / 创作档案

为 B 站中文 Vocaloid P 主 Utopia_乌托邦P 定制的个人博客与内容管理系统。项目使用 Vue 3 + Vite 构建主站，以 Express 提供文章、二创资源和后台管理 API。

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

需要 Node.js 24.7 或更高版本，以使用内置 Argon2id 密码哈希。

```bash
npm install
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
APP_ORIGIN=https://www.utopiap.top
ADMIN_PASSWORD_HASH=replace-with-output-of-npm-run-security-hash-password
ADMIN_SESSION_IDLE_MINUTES=30
ADMIN_SESSION_ABSOLUTE_HOURS=8
ADMIN_LOGIN_WINDOW_MINUTES=15
ADMIN_LOGIN_IP_LIMIT=10
ADMIN_LOGIN_ACCOUNT_LIMIT=30
ADMIN_LOGIN_CONCURRENCY=2
ADMIN_WRITE_WINDOW_MINUTES=10
ADMIN_WRITE_LIMIT=60
ADMIN_WRITE_CONCURRENCY=2
UPLOAD_MAX_FILE_MB=100
UPLOAD_TOTAL_QUOTA_MB=1024
UPLOAD_WINDOW_MINUTES=60
UPLOAD_LIMIT=10
UPLOAD_CONCURRENCY=1
UPLOAD_VIRUS_SCAN_COMMAND=clamscan
UPLOAD_VIRUS_SCAN_ARGS=["--no-summary"]
TRUST_PROXY_HOPS=1
PORT=8787
```

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | 管理密码的 Argon2id 哈希；生产环境必须设置，不能填写明文密码 |
| `APP_ORIGIN` | 允许发起管理写请求的 HTTPS Origin；不含路径，多个地址使用逗号分隔 |
| `ADMIN_SESSION_IDLE_MINUTES` | 管理会话空闲过期时间，默认 30 分钟 |
| `ADMIN_SESSION_ABSOLUTE_HOURS` | 管理会话绝对过期时间，默认 8 小时 |
| `ADMIN_LOGIN_WINDOW_MINUTES` | 登录限流统计窗口，默认 15 分钟 |
| `ADMIN_LOGIN_IP_LIMIT` | 单 IP 在统计窗口内允许的失败登录次数，默认 10 次 |
| `ADMIN_LOGIN_ACCOUNT_LIMIT` | 管理账户在统计窗口内允许的总失败次数，默认 30 次 |
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
| `PORT` | Express 服务端口，默认 `8787` |
| `NODE_ENV` | 设置为 `production` 时启用生产 Cookie 与缓存策略，并强制检查认证配置 |
| `VITE_BILIBILI_SYNC_URL` | 覆盖默认的同源 `/api/bilibili/feed` 聚合接口地址 |
| `VITE_BILIBILI_SPACE_URL` | 主站跳转到 Bilibili 个人空间的地址 |
| `BILIBILI_UID` | 服务端同步的 Bilibili 用户 UID，默认 `1858510441` |
| `BILIBILI_COOKIE` | 可选的服务端 Cookie，用于降低公开接口触发风控的概率 |

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

后台文章元数据保存在 `server/data/content.json`，上传文件保存在 `server/uploads/`。草稿不会通过公开接口返回。

## Markdown 文章

文章统一通过 `/admin` 后台使用 Markdown 编写，支持实时预览、草稿和发布。文章数据保存在 `server/data/content.json`，主站通过 `/api/content` 读取已发布内容，草稿不会公开显示。

Markdown 渲染结果会经过 DOMPurify 清理。API 不可用或没有已发布文章时，主站显示空状态。

## 二创资源

二创资源统一通过 `/admin` 后台上传。文件使用服务端随机名存放在 `server/uploads/`，元数据写入 `server/data/content.json`；也可以通过 `APP_STORAGE_ROOT` 将两者放入独立持久化目录。存储目录不提供静态访问，下载统一经过 `/api/resources/:id/download`，强制使用附件模式、`nosniff` 和 UTF-8 文件名。删除操作先隔离磁盘文件，再提交元数据并记录安全审计事件。没有资源时主站显示空状态。

## Bilibili 同步

主站默认读取同源 `/api/bilibili/feed`。Express 服务端通过 WBI 签名接口获取 `BILIBILI_UID` 对应的全部空间投稿，同时提取最近三条动态，并将结果缓存 10 分钟。视频封面通过同源 `/api/bilibili/image` 代理，按需获取 `960 x 540` WebP 缩略图，并使用受限的服务端内存缓存和浏览器长期缓存，避免 Bilibili 图片防盗链及原图过大导致加载缓慢。浏览器不会直接请求 Bilibili。

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
npm run build
npm start
```

`npm run build` 生成 `dist/`。`npm start` 启动 Express，并在同一端口提供 API、受控资源下载和构建后的单页应用，默认地址为 `http://127.0.0.1:8787`。

生产环境建议：

- 设置 `NODE_ENV=production`、正确的 `APP_ORIGIN` 和 `ADMIN_PASSWORD_HASH`
- 使用 Nginx、Caddy 或其他反向代理提供 HTTPS
- 将请求转发到 Express 的 `PORT`
- 持久化并定期备份 `server/data/` 和 `server/uploads/`
- 限制 `/admin` 的访问来源或增加额外认证层

不要只部署 `dist/`：纯静态部署可以浏览内置内容，但后台、动态文章和上传资源 API 将不可用。

### 反向代理示例

如果前端静态文件和 Express 分开提供，必须确保 `/api/` 在 SPA 回退规则之前转发到 Express，并在 Nginx 明确拒绝 `/uploads/`。只允许 Nginx 访问 Express 端口，并使 `TRUST_PROXY_HOPS` 与实际代理层数一致。

以下共享内存区域必须定义在 Nginx 的 `http` 块中：

```nginx
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=admin_api:10m rate=30r/m;
limit_conn_zone $binary_remote_addr zone=admin_conn:10m;
```

`server` 块中的路由示例：

```nginx
client_header_timeout 15s;
client_body_timeout 30s;
send_timeout 120s;

location = /api/admin/auth/login {
    client_max_body_size 16k;
    limit_req zone=admin_login burst=3 nodelay;
    limit_conn admin_conn 5;

    proxy_pass http://127.0.0.1:8787;
    proxy_connect_timeout 5s;
    proxy_send_timeout 15s;
    proxy_read_timeout 15s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/admin/ {
    client_max_body_size 101m;
    limit_req zone=admin_api burst=20 nodelay;
    limit_conn admin_conn 5;

    proxy_pass http://127.0.0.1:8787;
    proxy_connect_timeout 5s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /uploads/ {
    return 404;
}

location / {
    try_files $uri $uri/ /index.html;
}
```

后台出现 `Unexpected token '<'` 表示 `/api/` 返回了 `index.html`，通常是 SPA 的 `try_files` 或重写规则优先于 API 代理。调整为上述顺序后再检查：

```bash
curl -i https://你的域名/api/health
```

正常响应的 `Content-Type` 应为 `application/json`，正文为 `{"ok":true}`。

## 验证命令

```bash
npm run build          # 生产构建
npm run audit:ui       # 桌面、平板和手机界面审计
npm run test:auth      # 后台认证与限流集成测试
npm run test:uploads   # 上传、扫描、下载与删除安全集成测试
npm run security:secrets
npm run optimize:images
```

`audit:ui` 使用本机 Microsoft Edge，截图保存在 `.screenshots/`，并检查横向溢出、控制台错误、后台粘性导航和切页滚动位置。

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
```
