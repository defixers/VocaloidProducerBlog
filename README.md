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
| `VITE_BILIBILI_SYNC_URL` | Bilibili 聚合接口地址；不配置时使用本地内容 |
| `VITE_BILIBILI_SPACE_URL` | 主站跳转到 Bilibili 个人空间的地址 |

`VITE_` 开头的变量会在构建时进入前端代码，不能在其中保存 Cookie、Access Key 或签名密钥。

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

项目有两类文章来源：

1. 内置文章位于 `src/content/`，适合随 Git 版本管理。
2. 后台文章通过 `/admin` 发布，保存在服务器数据文件中。

内置文章在 `src/data.js` 中配置元数据，并通过 Vite 的 `?raw` 导入 Markdown：

```js
import newArticleMarkdown from './content/new-article.md?raw'

{
  id: 4,
  title: '文章标题',
  markdown: newArticleMarkdown,
}
```

主站启动后会读取 `/api/content`，将后台已发布文章与内置文章合并。API 不可用时仍会显示内置内容。Markdown 渲染结果会经过 DOMPurify 清理。

## 二创资源

内置下载文件位于 `public/downloads/`，并在 `src/data.js` 中配置：

```js
{
  name: '《奇迹从来没出现》人声 MIDI',
  downloadUrl: '/downloads/miracle-vocal.mid',
  downloadName: '奇迹从来没出现人声midi.mid',
}
```

后台上传的资源存放在 `server/uploads/`，其元数据写入 `server/data/content.json`。主站会合并内置资源与后台资源。

## Bilibili 同步

浏览器只读取 `VITE_BILIBILI_SYNC_URL` 指向的统一 JSON 接口。Bilibili 的鉴权、Cookie、WBI 签名和缓存应由你自己的服务端或反向代理处理，本项目当前不直接保存这些凭据。

接口响应格式：

```json
{
  "syncedAt": "2026-09-26T14:20:00+08:00",
  "videos": [
    {
      "id": "BV...",
      "title": "视频标题",
      "stats": "12.8万播放 · 9,402收藏",
      "date": "09-15",
      "cover": "https://...",
      "duration": "4:12"
    }
  ],
  "dynamics": [
    {
      "time": "今天 14:20",
      "text": "动态正文",
      "topic": "#话题"
    }
  ]
}
```

接口未配置、超时或返回错误时，主站自动回退到 `src/data.js` 中的本地视频和动态。

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

## 验证命令

```bash
npm run build          # 生产构建
npm run audit:ui       # 桌面、平板和手机界面审计
npm run optimize:images
```

`audit:ui` 使用本机 Microsoft Edge，截图保存在 `.screenshots/`，并检查横向溢出、控制台错误、后台粘性导航和切页滚动位置。

## 项目结构

```text
public/                 静态图片和内置下载文件
scripts/                图片优化与界面审计脚本
server/
  data/content.json     后台文章和资源元数据
  uploads/              后台上传文件
  index.js              Express API 与生产静态服务
src/
  content/              内置 Markdown 文章
  services/             后台 API 与 Bilibili 同步客户端
  AdminApp.vue          管理后台
  App.vue               主站
  data.js               内置文章、视频、动态和资源数据
```
