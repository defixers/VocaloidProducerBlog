# 配置参考

应用启动时由 Node.js 从仓库根目录加载 `.env`。[.env.example](.env.example) 是应用配置的唯一模板；本文件解释变量分组和生产要求，不重复维护所有默认值。实际默认值以该模板和 `server/security/validation.js` 为准。

备份程序使用独立的 root 所有配置文件 `/etc/vocaloid-producer-blog/backup.env`，模板为 [deploy/backup.env.example](deploy/backup.env.example)。不要把 `BACKUP_*` 或离机存储凭据写入应用 `.env`。

## 本地开发

本地开发通常不需要 `.env`：

```bash
npm ci
npm run dev:full
```

未设置 `NODE_ENV=production` 时，默认管理密码为 `utopia-dev`，允许的 Origin 包含本机 Vite 和 Express 地址，数据默认写入 `server/data` 与 `server/uploads`。

如果需要覆盖单个开发选项，只在 `.env` 中写必要变量。不要直接复制生产配置后继续使用开发密码。

## 生产配置

Alibaba Cloud Linux 4 安装器会交互收集域名、TLS 文件和管理密码，并创建权限受限的生产 `.env`。使用安装器时不要手工复制 `.env.example`。

自定义部署可以从模板开始：

```bash
cp .env.example .env
npm run security:hash-password
openssl rand -hex 32
```

将密码命令输出写入 `ADMIN_PASSWORD_HASH`，将随机值写入 `SECURITY_LOG_IP_KEY`。生产环境至少必须检查：

| 变量 | 要求 |
| --- | --- |
| `NODE_ENV` | 必须为 `production` |
| `APP_ORIGIN` | 允许管理写请求的完整 HTTPS Origin，多个值用逗号分隔 |
| `ADMIN_PASSWORD_HASH` | `security:hash-password` 生成的 Argon2id 哈希，不能填写明文 |
| `SECURITY_LOG_IP_KEY` | 至少 32 个随机字符，用于日志 IP 脱敏 |
| `APP_STORAGE_ROOT` | Git 工作区之外的持久化目录 |
| `TRUST_PROXY_HOPS` | 单层 Nginx 使用 `1`，必须与真实代理层数一致 |
| `UPLOAD_VIRUS_SCAN_COMMAND` | 推荐使用 `clamscan` 的绝对路径 |

生产 `.env` 应由 root 管理，只允许应用组读取。修改后执行：

```bash
sudo systemctl restart vocaloid-producer-blog
sudo journalctl -u vocaloid-producer-blog -n 100 --no-pager
```

## 浏览器构建变量

| 变量 | 说明 |
| --- | --- |
| `VITE_BILIBILI_SYNC_URL` | 浏览器调用的同源同步接口，默认 `/api/bilibili/feed` |
| `VITE_BILIBILI_SPACE_URL` | 站点跳转到的 Bilibili 个人空间 |

所有 `VITE_` 变量都会进入前端构建。Cookie、Access Key、密码、签名密钥和内部地址不得使用该前缀。

## Bilibili 服务端变量

| 变量组 | 说明 |
| --- | --- |
| `BILIBILI_UID` | 同步目标用户 UID |
| `BILIBILI_COOKIE` | 可选服务端 Cookie，不得提交到 Git |
| `BILIBILI_UPSTREAM_TIMEOUT_SECONDS` | 单次上游请求超时 |
| `BILIBILI_JSON_MAX_MB`、`BILIBILI_IMAGE_MAX_MB` | 上游 JSON 和图片响应上限 |
| `BILIBILI_REDIRECT_LIMIT` | 上游最大重定向次数 |
| `BILIBILI_IMAGE_CACHE_MB`、`BILIBILI_IMAGE_CACHE_ENTRIES` | 图片内存缓存容量和条目上限 |

## 管理认证和写入限制

| 变量组 | 说明 |
| --- | --- |
| `ADMIN_SESSION_IDLE_MINUTES`、`ADMIN_SESSION_ABSOLUTE_HOURS` | 会话空闲和绝对过期时间 |
| `ADMIN_LOGIN_WINDOW_MINUTES` | 登录失败统计窗口 |
| `ADMIN_LOGIN_IP_LIMIT`、`ADMIN_LOGIN_ACCOUNT_LIMIT` | IP 和账户失败次数限制 |
| `ADMIN_LOGIN_BACKOFF_BASE_MS`、`ADMIN_LOGIN_BACKOFF_MAX_MS` | 登录失败指数退避范围 |
| `ADMIN_LOGIN_CONCURRENCY` | Argon2id 验证并发上限 |
| `ADMIN_WRITE_WINDOW_MINUTES`、`ADMIN_WRITE_LIMIT` | 管理写请求窗口和次数限制 |
| `ADMIN_WRITE_CONCURRENCY` | 单会话并发写入上限 |

`APP_ORIGIN` 必须只包含实际管理站点，不含路径。生产 Cookie 使用 `HttpOnly` 和 `SameSite=Strict`，写操作还要求匹配 Origin 与 CSRF Token。

## 内容与上传

| 变量组 | 说明 |
| --- | --- |
| `ARTICLE_IMAGE_HOSTS` | 远程文章封面的 HTTPS 域名白名单；站内 `/images/` 始终允许 |
| `UPLOAD_MAX_FILE_MB`、`UPLOAD_TOTAL_QUOTA_MB` | 单文件和上传目录容量限制 |
| `UPLOAD_WINDOW_MINUTES`、`UPLOAD_LIMIT`、`UPLOAD_CONCURRENCY` | 上传频率和并发限制 |
| `UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB` | 压缩包解压后总大小上限 |
| `UPLOAD_ARCHIVE_MAX_FILES`、`UPLOAD_ARCHIVE_MAX_DEPTH` | 压缩包文件数量和目录深度上限 |
| `UPLOAD_ARCHIVE_MAX_RATIO` | 最大压缩比 |
| `UPLOAD_VIRUS_SCAN_COMMAND`、`UPLOAD_VIRUS_SCAN_ARGS` | 扫描程序及 JSON 参数数组，文件路径自动追加 |
| `UPLOAD_SCAN_TIMEOUT_SECONDS` | 单次病毒扫描超时 |

扫描器缺失或失败时，ZIP、7Z 和 RAR 默认拒绝。生产安装器使用独立 ClamAV 病毒库，并将扫描程序配置为绝对路径。

## 公开接口限制

| 变量组 | 说明 |
| --- | --- |
| `PUBLIC_RATE_WINDOW_MINUTES` | 公开接口统一统计窗口 |
| `BILIBILI_FEED_RATE_LIMIT`、`BILIBILI_IMAGE_RATE_LIMIT` | 单 IP 同步和图片请求限制 |
| `BILIBILI_FEED_CONCURRENCY`、`BILIBILI_IMAGE_CONCURRENCY` | 同步和图片代理全局并发上限 |
| `RESOURCE_DOWNLOAD_RATE_LIMIT`、`RESOURCE_DOWNLOAD_CONCURRENCY` | 资源下载频率和并发上限 |
| `RESOURCE_DOWNLOAD_MAX_MB`、`RESOURCE_DOWNLOAD_TIMEOUT_SECONDS` | 单次下载大小和时间限制 |

## 服务与监控

| 变量组 | 说明 |
| --- | --- |
| `PORT` | Express 监听端口，默认 `8787` |
| `SERVER_HEADERS_TIMEOUT_SECONDS` | 接收完整请求头的超时 |
| `SERVER_REQUEST_TIMEOUT_SECONDS` | 完整请求处理超时 |
| `SECURITY_ALERT_WINDOW_MINUTES`、`SECURITY_ALERT_COOLDOWN_MINUTES` | 告警统计窗口和静默时间 |
| `SECURITY_ALERT_LOGIN_FAILURES` | 暴力登录告警阈值 |
| `SECURITY_ALERT_UPLOAD_REJECTIONS` | 异常上传告警阈值 |
| `SECURITY_ALERT_SERVER_ERRORS` | 服务端错误告警阈值 |
| `SECURITY_ALERT_PROXY_FAILURES`、`SECURITY_ALERT_PROXY_MIN_REQUESTS`、`SECURITY_ALERT_PROXY_FAILURE_RATE_PERCENT` | 上游代理异常判定条件 |
| `SECURITY_DISK_MIN_FREE_MB`、`SECURITY_DISK_CHECK_MINUTES` | 磁盘空间阈值和检查周期 |
| `SECURITY_ALERT_WEBHOOK_URL`、`SECURITY_ALERT_WEBHOOK_HOSTS` | 可选告警 Webhook 与精确主机白名单 |
| `SECURITY_ALERT_TIMEOUT_SECONDS` | Webhook 请求超时 |

不配置 Webhook 时，告警以 `security_alert` JSON 写入标准错误并由 journald 保存。启用 Webhook 时必须同时配置 HTTPS URL 和精确域名白名单。

## 备份配置

以下变量只属于 `/etc/vocaloid-producer-blog/backup.env`：

| 变量 | 说明 |
| --- | --- |
| `BACKUP_APP_ROOT` | 应用工作区绝对路径 |
| `APP_STORAGE_ROOT` | 被备份的持久化数据根目录 |
| `BACKUP_LOCAL_DIR` | 本机加密备份目录，必须位于数据根目录之外 |
| `BACKUP_ENCRYPTION_KEY_FILE` | 32 字节备份密钥文件，不得进入仓库或备份包 |
| `BACKUP_RETENTION_DAYS` | 本机备份保留天数 |
| `BACKUP_REQUIRE_REPLICA` | 是否要求离机复制成功才判定备份成功 |
| `BACKUP_REPLICA_COMMAND` | 离机复制程序绝对路径 |
| `BACKUP_REPLICA_ARGS` | JSON 参数数组，必须包含 `{file}`，可使用 `{name}` |
| `BACKUP_DRILL_LOG_DIR` | 恢复演练记录目录 |
| `BACKUP_TAR_COMMAND` | tar 程序路径 |
| `RCLONE_CONFIG` | 使用 rclone 时的独立配置文件路径 |

备份密钥必须保存到服务器之外的受控密码库。本机备份无法抵御整机损坏或服务器失陷；启用离机存储后应设置 `BACKUP_REQUIRE_REPLICA=true` 并完成真实恢复演练。
