# Utopia_乌托邦P / 创作档案模板

为 Utopia_乌托邦P 定制的 Vue 3 + Vite 单页博客模板，包含文章阅读与筛选、Bilibili 视频/动态同步展示，以及带许可说明的二创资料室。视觉素材来自其公开投稿封面，风格围绕校园现实、科幻阅读与原创摇滚展开。

## 本地运行

```bash
npm install
npm run dev:full
```

主站：`http://127.0.0.1:5173/`

管理后台：`http://127.0.0.1:5173/admin`

开发环境默认管理令牌为 `utopia-dev`。生产环境必须复制 `.env.example` 为 `.env`，并将 `ADMIN_TOKEN` 替换为足够长的随机字符串。

生产构建：

```bash
npm run build
npm start
```

`npm start` 会同时提供 API、上传文件和构建后的主站，默认监听 `8787`。生产环境应通过反向代理将域名指向该端口，并持久化备份 `server/data/` 与 `server/uploads/`。

## 管理后台

后台采用令牌认证，包含：

- 工作概览与发布状态统计
- Markdown 文章新建、实时预览、草稿、发布、编辑和删除
- 二创文件上传、下载和删除
- 已发布文章与资源自动同步到主站

文章内容保存在 `server/data/content.json`，上传文件保存在 `server/uploads/`。草稿不会通过公开接口返回。

## 接入 Bilibili 同步

复制 `.env.example` 为 `.env`，设置 `VITE_BILIBILI_SYNC_URL`。由于 Bilibili 鉴权、签名与 Cookie 不应暴露给浏览器，模板约定由你自己的服务端完成同步，前端只读取统一接口：

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
    { "time": "今天 14:20", "text": "动态正文", "topic": "#话题" }
  ]
}
```

接口未配置或暂时不可用时，页面自动使用 `src/data.js` 中的演示内容。文章、素材和演示视频也集中在该文件，替换内容无需改组件。

## 素材下载

下载文件存放在 `public/downloads/`，并在 `src/data.js` 的素材项中配置 `downloadUrl` 和 `downloadName`。当前已提供《奇迹从来没出现》人声 MIDI：

```text
/downloads/miracle-vocal.mid
```

## 编写文章

文章正文位于 `src/content/`，使用标准 Markdown 编写。文章列表需要的标题、日期、分类、摘要和封面保存在 `src/data.js`，通过 Vite 的 `?raw` 导入对应 Markdown 文件：

```js
import newArticleMarkdown from './content/new-article.md?raw'

{
  id: 4,
  title: '文章标题',
  markdown: newArticleMarkdown,
}
```

正文支持标题、列表、引用和链接。渲染后的 HTML 会经过 DOMPurify 清理。

## 优化图片

将原始 JPG 放入 `public/images/` 后运行：

```bash
npm run optimize:images
```

脚本会生成 `640px` 和 `1600px` 两档 WebP。首页通过 `srcset` 为不同设备选择尺寸，非首屏图片会延迟加载。
