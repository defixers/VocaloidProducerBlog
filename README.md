# Utopia_乌托邦P / 创作档案

为 B 站中文 Vocaloid P 主 Utopia_乌托邦P 定制的个人博客与内容管理系统。项目使用 Vue 3 + Vite 构建主站，以 Express 提供文章、二创资源和后台管理 API。

## 功能

- 作品主页、文章归档、视频列表、动态展示与全文搜索
- Markdown 文章阅读，以及后台实时预览、草稿和发布管理
- Bilibili 视频与动态的服务端同步接口
- 二创资源展示、上传、下载和删除
- 桌面、平板和手机响应式管理界面
- WebP 响应式图片、非首屏延迟加载和前后台代码分包
- 管理令牌认证、上传类型限制和 100 MB 文件大小限制

## 技术栈

- Vue 3
- Vite
- Express
- Marked + DOMPurify
- Multer
- Lucide Vue

## 快速开始

需要 Node.js 20.19 或更高版本。

```bash
npm install
npm run dev:full
```

开发地址：

- 主站：`http://127.0.0.1:5173/`
- 管理后台：`http://127.0.0.1:5173/admin`
- 开发环境管理令牌：`utopia-dev`
- API 健康检查：`http://127.0.0.1:8787/api/health`

只启动某一部分时可以使用：

```bash
npm run dev       # Vite 前端
npm run server    # Express API
```

开发模式下 Vite 会将 `/api` 和 `/uploads` 代理到 `127.0.0.1:8787`，因此后台管理功能需要 Express API 同时运行。

## 环境变量

复制 `.env.example` 为 `.env`：

```dotenv
VITE_BILIBILI_SYNC_URL=/api/bilibili/feed
VITE_BILIBILI_SPACE_URL=https://space.bilibili.com/1858510441
NODE_ENV=production
ADMIN_TOKEN=replace-with-a-long-random-token
PORT=8787
```

| 变量 | 说明 |
| --- | --- |
| `ADMIN_TOKEN` | 后台登录令牌；生产环境必须设置为足够长的随机字符串 |
| `PORT` | Express 服务端口，默认 `8787` |
| `NODE_ENV` | 设置为 `production` 时启用生产缓存策略并强制检查管理令牌 |
| `VITE_BILIBILI_SYNC_URL` | 覆盖默认的同源 `/api/bilibili/feed` 聚合接口地址 |
| `VITE_BILIBILI_SPACE_URL` | 主站跳转到 Bilibili 个人空间的地址 |
| `BILIBILI_UID` | 服务端同步的 Bilibili 用户 UID，默认 `1858510441` |
| `BILIBILI_COOKIE` | 可选的服务端 Cookie，用于降低公开接口触发风控的概率 |

`VITE_` 开头的变量会在构建时进入前端代码，不能在其中保存 Cookie、Access Key 或签名密钥。

可使用以下命令生成高强度管理令牌：

```bash
npm run security:generate-token
```

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

二创资源支持 MID、MIDI、WAV、MP3、FLAC、ZIP、7Z、RAR、PNG、JPG、JPEG、WebP、PDF、PSD 和 TXT，单个文件最大 100 MB。上传成功后会立即显示在主站下载区。

后台文章元数据保存在 `server/data/content.json`，上传文件保存在 `server/uploads/`。草稿不会通过公开接口返回。

## Markdown 文章

文章统一通过 `/admin` 后台使用 Markdown 编写，支持实时预览、草稿和发布。文章数据保存在 `server/data/content.json`，主站通过 `/api/content` 读取已发布内容，草稿不会公开显示。

Markdown 渲染结果会经过 DOMPurify 清理。API 不可用或没有已发布文章时，主站显示空状态。

## 二创资源

二创资源统一通过 `/admin` 后台上传。文件存放在 `server/uploads/`，元数据写入 `server/data/content.json`，上传后会自动显示在主站素材区。下载接口使用 UTF-8 文件名，并自动兼容旧数据中被错误编码的中文文件名。没有资源时主站显示空状态。

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

`npm run build` 生成 `dist/`。`npm start` 启动 Express，并在同一端口提供 API、上传文件和构建后的单页应用，默认地址为 `http://127.0.0.1:8787`。

生产环境建议：

- 设置 `NODE_ENV=production` 和强随机 `ADMIN_TOKEN`
- 使用 Nginx、Caddy 或其他反向代理提供 HTTPS
- 将请求转发到 Express 的 `PORT`
- 持久化并定期备份 `server/data/` 和 `server/uploads/`
- 限制 `/admin` 的访问来源或增加额外认证层

不要只部署 `dist/`：纯静态部署可以浏览内置内容，但后台、动态文章和上传资源 API 将不可用。

### 反向代理示例

如果前端静态文件和 Express 分开提供，必须确保 `/api/` 与 `/uploads/` 在 SPA 回退规则之前转发到 Express。Nginx 示例：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /uploads/ {
    proxy_pass http://127.0.0.1:8787;
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
