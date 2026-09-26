# Utopia_乌托邦P / 创作档案模板

为 Utopia_乌托邦P 定制的 Vue 3 + Vite 单页博客模板，包含文章阅读与筛选、Bilibili 视频/动态同步展示，以及带许可说明的二创资料室。视觉素材来自其公开投稿封面，风格围绕校园现实、科幻阅读与原创摇滚展开。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

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

目前下载按钮展示模板交互。上线时可给 `src/data.js` 中的素材项增加 `downloadUrl`，并在 `downloadAsset` 中替换为对象存储、CDN 或经过鉴权的下载地址。

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
