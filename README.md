# Utopia_乌托邦P / 创作档案

为 B 站中文 Vocaloid P 主 Utopia_乌托邦P 定制的个人博客与内容管理系统。Vue 3 + Vite 提供主站和管理界面，Express 提供内容、二创资源、Bilibili 同步及后台管理 API。

## 功能

- 作品主页、文章归档、视频列表、动态展示与全文搜索
- Markdown 文章编辑、实时预览、草稿和发布管理
- Bilibili 视频、动态及图片的服务端同步与缓存
- 二创资源上传、病毒扫描、受控下载和删除
- 桌面、平板和手机响应式界面
- Argon2id 管理密码、HttpOnly 会话、CSRF 防护和分层限流
- 加密备份、恢复演练、结构化安全日志及生产发布门禁

安全设计、当前阶段和验证证据以 [SECURITY_ROADMAP.md](SECURITY_ROADMAP.md) 为准。具体生产版本必须通过线上 `/build-info.json` 和发布记录确认，README 不固定某次生产提交。

## 技术栈

- Vue 3、Vite
- Express、Zod、Multer
- Marked、DOMPurify
- Lucide Vue

## 本地开发

需要 Node.js 24.21.x 和 npm 11.19.0。版本由 `package.json` 和 `.nvmrc` 约束。

```bash
npm ci
npm run dev:full
```

本地开发默认不需要 `.env`，并使用以下地址：

- 主站：`http://127.0.0.1:5173/`
- 管理后台：`http://127.0.0.1:5173/admin`
- 开发管理密码：`utopia-dev`
- API 健康检查：`http://127.0.0.1:8787/api/health`

`npm run dev:full` 同时启动 Vite 和 Express。也可分别运行：

```bash
npm run dev       # Vite 前端
npm run server    # Express API
```

Vite 将 `/api` 代理到 `127.0.0.1:8787`。如果工作区已有生产 `.env`，服务端会按生产模式启动；本地开发前应移走该文件或使用独立开发配置。

## 配置

应用会在启动时读取仓库根目录的 `.env`。[.env.example](.env.example) 是应用变量的唯一模板；变量用途、开发与生产差异、密码哈希及备份配置见 [CONFIGURATION.md](CONFIGURATION.md)。

生产环境不要把明文密码、Bilibili Cookie、Access Key 或备份密钥提交到 Git。`VITE_` 前缀变量会进入浏览器构建，不能保存任何秘密。

## 内容与存储

后台位于 `/admin`，包含工作概览、文章管理和二创资源管理。

| 环境 | 文章和资源元数据 | 上传文件 |
| --- | --- | --- |
| 本地开发默认 | `server/data/content.json` | `server/uploads/` |
| 生产环境 | `$APP_STORAGE_ROOT/data/content.json` | `$APP_STORAGE_ROOT/uploads/` |

生产环境必须将 `APP_STORAGE_ROOT` 放在 Git 工作区之外。草稿不会由公开接口返回；上传目录也不提供静态访问，资源统一通过 `/api/resources/:id/download` 下载。

文章使用 Markdown 编写，主站和后台预览共用 DOMPurify 白名单。二创资源支持 MID、MIDI、WAV、MP3、FLAC、ZIP、7Z、RAR、PNG、JPG、JPEG、WebP、PDF、PSD 和 TXT。服务端检查扩展名、MIME、文件签名和压缩包结构；生产环境使用 ClamAV 同步扫描高风险压缩格式。

## Bilibili 同步

主站默认读取同源 `/api/bilibili/feed`，服务端负责 WBI 请求、动态聚合、图片代理、缓存、超时、响应大小限制和 SSRF 防护。浏览器不会直接携带 Bilibili Cookie。

数据中心 IP 遇到 Bilibili `412` 时，可在服务端 `.env` 设置 `BILIBILI_COOKIE` 后重启应用。该变量不能添加 `VITE_` 前缀，也不能提交到 Git。

## Alibaba Cloud Linux 4

全新服务器优先使用 [Alibaba Cloud Linux 4 完整安装说明](deploy/INSTALL_ALINUX4.md)。安装器配置固定版本 Node.js、ClamAV、Nginx HTTPS、systemd、端口隔离、本机加密备份和恢复演练。

```bash
sudo bash deploy/install-alinux4.sh
```

安装器还提供受限的密码阶段恢复和显式完整重装：

```bash
sudo bash deploy/install-alinux4.sh --resume
sudo bash deploy/install-alinux4.sh --reinstall
```

`--resume` 只接受文档规定的特定中断状态。`--reinstall` 会在固定确认短语后永久删除本站数据、配置、备份和专用账户；执行前必须完成离机备份。

安装成功后服务会自动启动：

```bash
sudo systemctl status vocaloid-producer-blog nginx vpb-port-guard
sudo journalctl -u vocaloid-producer-blog -n 100 --no-pager
```

## 手动构建

以下命令用于本地验证或自定义部署，不替代生产 systemd、HTTPS、防火墙和备份配置：

```bash
npm ci
npm run verify:reproducible
npm run verify:build
npm start
```

`npm start` 在前台启动 Express，并在 `8787` 端口提供 API、受控下载和构建后的单页应用。生产环境必须阻止公网直连该端口。反向代理、systemd、日志、发布和回滚步骤见 [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)。

## 备份与恢复

`npm run backup:create` 创建包含文章、上传资源和服务端 `.env` 的 AES-256-GCM 加密备份；`backup:restore` 仅恢复到空目录；`backup:drill` 执行完整恢复演练。

Alibaba Cloud Linux 3 的以下脚本只配置既有网站的备份系统，不安装网站本身：

```bash
sudo bash deploy/setup-alinux3-backup.sh
```

Alibaba Cloud Linux 4 完整安装器已经包含备份配置。本机备份不能应对整机丢失或服务器失陷，生产环境应保存离线密钥并配置经过验证的离机副本。

## 发布门禁

发布门禁不依赖特定 Linux 版本。部署前传入当前线上完整提交 SHA：

```bash
CURRENT_DEPLOY_COMMIT=当前线上完整提交SHA npm run release:preflight
```

部署后验证候选提交：

```bash
DEPLOY_COMMIT=$(git rev-parse HEAD) npm run release:verify
```

门禁会检查干净工作区、供应链、敏感文件、安全测试、可复现构建、构建来源和生产公开边界。失败时不得继续或确认发布完成。

## 常用验证

```bash
npm run build
npm run audit:ui
npm run test:auth
npm run test:uploads
npm run test:public
npm run test:content
npm run test:monitoring
npm run test:backup
npm run test:deploy
npm run test:smoke
npm run security:supply-chain
npm run security:secrets
npm audit --audit-level=high --registry=https://registry.npmjs.org
```

生产只读冒烟检查还需要设置 `DEPLOY_COMMIT` 后执行 `npm run smoke:production`。`audit:ui` 使用本机 Microsoft Edge，截图写入 `.screenshots/`。

首次克隆后可启用仓库提供的提交前敏感文件检查：

```bash
git config core.hooksPath .githooks
```

## 文档

- [CONFIGURATION.md](CONFIGURATION.md)：应用及备份环境变量
- [deploy/INSTALL_ALINUX4.md](deploy/INSTALL_ALINUX4.md)：Alibaba Cloud Linux 4 安装、恢复和重装
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)：生产部署、备份、发布和回滚
- [SECURITY_ROADMAP.md](SECURITY_ROADMAP.md)：安全阶段、控制措施和验证证据

## 项目结构

```text
public/                  公开图片资源
src/                     Vue 主站和管理界面
server/                  Express API、安全模块及开发默认数据
scripts/                 测试、构建验证、备份和运维工具
deploy/                  安装器、发布门禁和 systemd 单元
CONFIGURATION.md         环境变量参考
PRODUCTION_DEPLOYMENT.md 生产部署与回滚手册
SECURITY_ROADMAP.md      安全路线图与证据
```

## 开源协议

项目源代码采用 [MIT License](LICENSE) 开源，Copyright (c) 2026 Utopia_乌托邦P。

站点展示的音乐作品、封面和可下载二创素材不因源代码采用 MIT 协议而自动授权；相关内容仍以作者或对应权利人的单独说明为准。
