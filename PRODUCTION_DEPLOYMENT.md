# 生产部署与安全验收

本文档适用于 `utopiap.top` 和 `www.utopiap.top` 的生产部署。目标是让每次发布都来自唯一、干净且经过 CI 验证的 Git 提交，并确保运行时数据、HTTPS 边界和回滚路径不依赖 Git 工作区中的临时状态。

## 1. 部署原则

- 生产流量只通过 Nginx 的 `80` 和 `443` 端口进入。
- Express 使用 `8787`，云安全组和主机防火墙不得向公网开放该端口。
- Nginx 是唯一可信反向代理时，`.env` 使用 `TRUST_PROXY_HOPS=1`。
- `APP_STORAGE_ROOT` 必须指向 Git 工作区之外的持久化目录。
- 不从包含未提交修改的工作区构建，也不把生产数据写回仓库目录。
- 发布前验证源码、依赖、测试与产物来源；发布后验证线上提交 SHA 和安全控制。
- `.env`、Bilibili Cookie、密码哈希、数据文件和上传文件不得进入 Git 或 CI 构建产物。

## 2. 目录与权限

推荐目录：

```text
/home/admin/VocaloidProducerBlog/       应用 Git 工作区
/var/lib/vocaloid-producer-blog/        持久化数据根目录
  data/content.json
  uploads/
/var/backups/vocaloid-producer-blog/    本地加密备份暂存目录
/opt/vocaloid-producer-blog-backup/     root 所有的只读备份程序
/etc/vocaloid-producer-blog/            备份配置与加密密钥
/etc/nginx/sites-available/utopiap.top   Nginx 站点配置
/etc/nginx/snippets/utopia-security.conf
```

创建持久化目录，并确保只有运行应用的账户可以写入：

```bash
sudo install -d -o admin -g admin -m 0750 /var/lib/vocaloid-producer-blog
sudo install -d -o admin -g admin -m 0750 /var/lib/vocaloid-producer-blog/data
sudo install -d -o admin -g admin -m 0750 /var/lib/vocaloid-producer-blog/uploads
```

首次迁移现有数据前必须先停止写入并备份 `server/data/`、`server/uploads/` 和 `.env`。确认目标目录中的文件数量、大小和权限后，再将 `.env` 设置为：

```dotenv
APP_STORAGE_ROOT=/var/lib/vocaloid-producer-blog
```

不要在未确认备份可恢复的情况下删除旧数据目录。

## 3. 生产环境变量

生产 `.env` 至少确认以下内容：

```dotenv
NODE_ENV=production
APP_ORIGIN=https://utopiap.top,https://www.utopiap.top
TRUST_PROXY_HOPS=1
PORT=8787
APP_STORAGE_ROOT=/var/lib/vocaloid-producer-blog
ADMIN_PASSWORD_HASH=有效的Argon2id哈希
SECURITY_LOG_IP_KEY=至少32字符的随机密钥
UPLOAD_VIRUS_SCAN_COMMAND=clamscan
UPLOAD_VIRUS_SCAN_ARGS=["--no-summary"]
```

限制环境文件权限：

```bash
chmod 600 .env
```

`VITE_` 前缀的值会进入浏览器产物，禁止用于 Cookie、密码、令牌或签名密钥。

生成独立的日志 IP 脱敏密钥，不得复用管理密码或其他令牌：

```bash
openssl rand -hex 32
```

## 4. 发布前检查

从 `main` 的干净检出执行：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --porcelain=v1
git rev-parse HEAD
```

`git status --porcelain=v1` 必须没有输出。如果因为历史重写、分支分叉或本地修改导致 `--ff-only` 失败，应停止发布并使用新的发布目录重新克隆；不要在未备份生产数据时执行 `git reset --hard`。

安装与验证：

```bash
npm ci
npm run security:supply-chain
npm audit --audit-level=high --registry=https://registry.npmjs.org
npm run security:secrets
npm run test:auth
npm run test:uploads
npm run test:public
npm run test:content
npm run test:monitoring
npm run test:backup
npm run test:deploy
npm run verify:reproducible
npm run verify:build
```

检查构建来源：

```bash
cat dist/build-info.json
```

要求：

- `commit` 等于 `git rev-parse HEAD` 输出的完整 40 位 SHA。
- `dirty` 为 `false`。
- GitHub 上同一提交的 `Security and reproducible build / verify` 与 `CodeQL / analyze` 均成功。

若使用 CI 下载的预构建产物，使用记录的提交 SHA 验证：

```bash
DEPLOY_COMMIT=完整的40位提交SHA npm run verify:build
```

## 5. systemd 服务

先使用 `command -v node` 确认 Node.js 24.21.x 的实际路径。以下示例假设为 `/usr/bin/node`。

创建 `/etc/systemd/system/vocaloid-producer-blog.service`：

```ini
[Unit]
Description=Vocaloid Producer Blog
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=admin
Group=admin
WorkingDirectory=/home/admin/VocaloidProducerBlog
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/vocaloid-producer-blog
UMask=0027

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vocaloid-producer-blog
sudo systemctl status vocaloid-producer-blog
sudo journalctl -u vocaloid-producer-blog -n 100 --no-pager
```

### 5.1 安全日志、保留与告警

应用将单行 JSON 写入 stdout/stderr，由 systemd-journald 集中采集。来源 IP 只记录不可逆的 HMAC 标识；不要将 `SECURITY_LOG_IP_KEY` 提交到仓库。创建 `/etc/systemd/journald.conf.d/vocaloid-blog.conf`：

```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
Compress=yes
Seal=yes
```

应用配置并确认日志目录权限：

```bash
sudo systemctl restart systemd-journald
sudo stat -c '%U %G %a %n' /var/log/journal
sudo journalctl -u vocaloid-producer-blog --since '30 minutes ago' -o cat
```

日志读取权限仅授予 `root` 和确需排障的 `systemd-journal` 组成员，不要让 Web 服务账户加入该组。上述保留配置作用于本机全部 journald 日志；若服务器已有统一日志策略，应在容量评估后合并配置，而不是直接覆盖。

告警阈值使用 `.env.example` 中的 `SECURITY_ALERT_*` 与 `SECURITY_DISK_*` 配置。当前生产服务器明确不使用 Webhook 外发，`.env` 必须保持以下配置：

```dotenv
SECURITY_ALERT_WEBHOOK_URL=
SECURITY_ALERT_WEBHOOK_HOSTS=
SECURITY_ALERT_TIMEOUT_SECONDS=5
```

应用仍会将阈值告警以 `security_alert` JSON 写入 stderr，并由 journald 保存。当前部署不执行 `npm run security:test-alert`，也不会向维护者主动推送通知。维护者应使用以下命令定期检查最近告警：

```bash
sudo journalctl -u vocaloid-producer-blog --since '5 minutes ago' -o cat \
  | grep '"level":"security_alert"'
```

这意味着服务器具备检测和留存能力，但没有主动送达能力。若未来改变该部署决策，必须重新完成 Webhook 主机白名单、SSRF 防护和真实送达验收，不能直接填写未经审核的地址。

### 5.2 加密备份、离机副本与恢复演练

目标为 RPO 不超过 24 小时、RTO 不超过 2 小时。备份定时器每 12 小时运行一次。备份采用在线一致性快照：复制前后比较 `content.json`，检测到管理写入或资源变化时自动重试，并在加密前验证资源引用，因此不会中断网站服务。备份内容包括 `data/`、`uploads/` 和生产 `.env`，密钥与副本权限必须按敏感凭据管理。

#### Alibaba Cloud Linux 3 一键安装

在服务器的项目目录执行：

```bash
sudo bash deploy/setup-alinux3-backup.sh
```

脚本会从项目 `.nvmrc` 读取并安装经过 SHA-256 校验的官方 Node.js 独立运行时，不要求系统预先安装对应版本，也不会覆盖服务器现有 Node.js。它还会从项目 `.env` 读取 `APP_STORAGE_ROOT`；该值为空时，如果仓库内存在 `server/data/content.json` 和 `server/uploads/`，会自动使用项目的 `server/` 目录。脚本默认询问是否启用 OSS。选择 `no` 时不需要任何外部存储，自动完成备份账户、ACL、密钥、root 只读程序、独立配置、systemd 单元、首份本机加密备份、首次恢复演练和定时器启用。当前生产环境按该本机模式完成 3.10 验收，并明确接受其不能应对整机损坏、系统盘丢失或服务器失陷的风险；离机副本保留为后续加固项。

具备外部存储条件后，提前创建私有 OSS Bucket 和专用 RAM 用户，再次运行同一脚本并选择 `yes`。RAM 用户只授予目标 Bucket 前缀所需的列举、上传、读取和删除对象权限，不要使用主账号 AccessKey。脚本会额外安装经过校验的固定版本 rclone，隐藏输入 AccessKey Secret，执行 OSS 上传、下载比对和删除探针，并验证首份离机副本。随后还需在 OSS 控制台启用版本控制及至少 35 天生命周期。

无论是否启用 OSS，都应尽快把 `/etc/vocaloid-producer-blog/backup.key` 的内容保存到服务器之外的受控密码库；脚本不会输出该密钥。没有外部保存的密钥时，整机丢失后本机备份和密钥会同时丢失。

以下内容是脚本执行的完整手动步骤，主要用于审计和故障排查；使用一键脚本时不需要重复执行。

安装系统工具并创建独立的无登录备份账户：

```bash
sudo apt-get update
sudo apt-get install -y acl rclone tar
sudo useradd --system --home-dir /var/lib/vpb-backup --create-home \
  --shell /usr/sbin/nologin vpb-backup
sudo install -d -o vpb-backup -g vpb-backup -m 0700 /var/backups/vocaloid-producer-blog
sudo install -d -o vpb-backup -g vpb-backup -m 0700 /var/lib/vocaloid-producer-blog/drills
```

为备份账户授予生产数据和 `.env` 的只读权限。默认 ACL 确保以后新建的上传文件仍可被备份账户读取：

```bash
sudo setfacl -m u:vpb-backup:x /home/admin
sudo setfacl -m u:vpb-backup:rx /var/lib/vocaloid-producer-blog
sudo setfacl -R -m u:vpb-backup:rX /var/lib/vocaloid-producer-blog/data /var/lib/vocaloid-producer-blog/uploads
sudo find /var/lib/vocaloid-producer-blog/data /var/lib/vocaloid-producer-blog/uploads \
  -type d -exec setfacl -m d:u:vpb-backup:rX {} \;
sudo setfacl -m u:vpb-backup:r /home/admin/VocaloidProducerBlog/.env
```

生成独立的 32 字节备份密钥。密钥不能写入 `.env`、Git、备份目录或 rclone 远端；必须另存一份到受控的离线密码库，否则服务器完全损坏后无法解密备份：

```bash
sudo install -d -o root -g vpb-backup -m 0750 /etc/vocaloid-producer-blog
openssl rand -hex 32 | sudo tee /etc/vocaloid-producer-blog/backup.key >/dev/null
sudo chown vpb-backup:vpb-backup /etc/vocaloid-producer-blog/backup.key
sudo chmod 0600 /etc/vocaloid-producer-blog/backup.key
```

使用独立的对象存储账户配置 rclone。该账户只授予目标桶所需的最小权限，并在存储端启用版本控制和至少 35 天生命周期；离机存储不能是生产服务器上的另一个普通目录或磁盘分区：

```bash
sudo -u vpb-backup -H rclone config
sudo -u vpb-backup -H rclone lsd utopia-backups:
```

不要把备份命令、密钥路径和离机目标放入应用账户可写的 `.env`。将脚本安装到 root 所有的只读目录，并从模板创建独立配置：

```bash
sudo install -d -o root -g root -m 0755 /opt/vocaloid-producer-blog-backup/scripts/lib
sudo install -o root -g root -m 0644 scripts/lib/backup.mjs \
  /opt/vocaloid-producer-blog-backup/scripts/lib/backup.mjs
sudo install -o root -g root -m 0644 scripts/backup-data.mjs scripts/restore-backup.mjs scripts/restore-drill.mjs \
  /opt/vocaloid-producer-blog-backup/scripts/
sudo install -o root -g root -m 0600 deploy/backup.env.example \
  /etc/vocaloid-producer-blog/backup.env
sudoedit /etc/vocaloid-producer-blog/backup.env
```

`/etc/vocaloid-producer-blog/backup.env` 内容为：

```dotenv
BACKUP_APP_ROOT=/home/admin/VocaloidProducerBlog
APP_STORAGE_ROOT=/var/lib/vocaloid-producer-blog
BACKUP_LOCAL_DIR=/var/backups/vocaloid-producer-blog
BACKUP_ENCRYPTION_KEY_FILE=/etc/vocaloid-producer-blog/backup.key
BACKUP_RETENTION_DAYS=14
BACKUP_REQUIRE_REPLICA=true
BACKUP_REPLICA_COMMAND=/usr/bin/rclone
BACKUP_REPLICA_ARGS='["copyto","{file}","utopia-backups:vocaloid-producer-blog/{name}"]'
BACKUP_DRILL_LOG_DIR=/var/lib/vocaloid-producer-blog/drills
BACKUP_TAR_COMMAND=/usr/bin/tar
RCLONE_CONFIG=/var/lib/vpb-backup/.config/rclone/rclone.conf
```

该配置必须保持 `root:root`、权限 `0600`。systemd 以 root 读取配置后，再以 `vpb-backup` 账户运行 root 所有的只读脚本，避免应用账户通过篡改工作区脚本或 `.env` 获取备份密钥与离机凭据。`BACKUP_REPLICA_ARGS` 由 Node 直接传给复制程序，不经过 Shell；必须包含 `{file}`，`{name}` 会替换为备份文件名。生产环境必须保持 `BACKUP_REQUIRE_REPLICA=true`，任何本地创建、加密、校验或离机复制失败都会写入 `security_alert`、返回非零状态并使 systemd 单元失败。

安装并检查定时单元：

```bash
sudo install -m 0644 deploy/systemd/vocaloid-producer-blog-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/vocaloid-producer-blog-backup.timer /etc/systemd/system/
sudo install -m 0644 deploy/systemd/vocaloid-producer-blog-restore-drill.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/vocaloid-producer-blog-restore-drill.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/vocaloid-producer-blog-{backup,restore-drill}.{service,timer}
sudo systemctl daemon-reload
```

每次发布涉及 `scripts/lib/backup.mjs`、三个备份命令或 systemd 单元时，都必须重复上述 `install`、`systemd-analyze verify` 和 `daemon-reload`，确保生产任务执行的是本次经过审核的 root 所有副本，而不是 Git 工作区文件。

首次备份必须手动执行并验收，同时确认应用始终正常运行：

```bash
sudo systemctl start vocaloid-producer-blog-backup.service
sudo systemctl status vocaloid-producer-blog-backup.service
sudo systemctl is-active vocaloid-producer-blog.service
sudo journalctl -u vocaloid-producer-blog-backup.service -n 100 --no-pager
sudo -u vpb-backup bash -c 'cd /var/backups/vocaloid-producer-blog && sha256sum -c -- *.vpb.sha256'
sudo -u vpb-backup -H rclone lsf utopia-backups:vocaloid-producer-blog/
```

确认本地 `.vpb` 和 `.sha256` 均存在、校验成功且远端出现同名文件后，启用每 12 小时备份和每月恢复演练：

```bash
sudo systemctl enable --now vocaloid-producer-blog-backup.timer
sudo systemctl enable --now vocaloid-producer-blog-restore-drill.timer
systemctl list-timers 'vocaloid-producer-blog-*'
```

首次恢复演练也必须手动执行。演练只写入临时空目录，不会覆盖生产数据；成功记录保存在 `BACKUP_DRILL_LOG_DIR`：

```bash
sudo systemctl start vocaloid-producer-blog-restore-drill.service
sudo systemctl status vocaloid-producer-blog-restore-drill.service
sudo journalctl -u vocaloid-producer-blog-restore-drill.service -n 100 --no-pager
sudo ls -l /var/lib/vocaloid-producer-blog/drills/
sudo cat /var/lib/vocaloid-producer-blog/drills/restore-drill-*.json
```

记录必须包含 `startedAt`、`finishedAt`、`durationSeconds`、`outcome: succeeded`、校验文件数、内容版本和空的 `issues`。每月复查最后一条记录，确认演练间隔未超过一个月且耗时小于 7200 秒。

#### 从空环境恢复

恢复前从离机存储取回同名 `.vpb` 和 `.sha256` 文件，并从离线密码库恢复密钥。恢复命令拒绝非空目标目录和已存在的环境文件，不会原地覆盖生产数据：

```bash
sudo systemctl stop vocaloid-producer-blog.service
sudo install -d -o vpb-backup -g vpb-backup -m 0700 /var/lib/vocaloid-producer-blog-restore
sudo install -d -o vpb-backup -g vpb-backup -m 0700 /var/lib/vocaloid-config-restore
sudo -u vpb-backup -H env \
  BACKUP_APP_ROOT=/home/admin/VocaloidProducerBlog \
  BACKUP_ENCRYPTION_KEY_FILE=/etc/vocaloid-producer-blog/backup.key \
  BACKUP_TAR_COMMAND=/usr/bin/tar \
  /usr/bin/node /opt/vocaloid-producer-blog-backup/scripts/restore-backup.mjs \
  --backup /var/backups/vocaloid-producer-blog/备份文件.vpb \
  --target /var/lib/vocaloid-producer-blog-restore \
  --env-output /var/lib/vocaloid-config-restore/.env
```

成功后检查恢复日志、`data/content.json`、资源数量和 `.env`，再由维护者在保留旧目录作为回滚副本的前提下切换目录。切换后将数据所有者改回 `admin:admin`、`.env` 权限改为 `0600`，启动应用并执行本文第 10 节全部发布后验收。不得在未验证恢复结果时删除旧生产数据。

备份或演练失败时检查：

```bash
sudo journalctl --since '24 hours ago' -o cat \
  | grep -E 'backup_(create|restore|restore_drill)|"level":"security_alert"'
```

仅从服务器本机验证 Express：

```bash
curl -i http://127.0.0.1:8787/api/health
```

## 6. Nginx 安全响应头

创建 `/etc/nginx/snippets/utopia-security.conf`：

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests" always;
```

新 CSP 必须先用 `Content-Security-Policy-Report-Only` 验证首页、文章、Bilibili 封面、管理登录、Markdown 预览和上传下载。确认没有违规后才改为强制的 `Content-Security-Policy`。

不要在未确认所有子域名长期支持 HTTPS 前增加 HSTS `includeSubDomains` 或 `preload`。

## 7. Nginx 限流区域

以下配置放在 Nginx `http` 块中，不能放入 `server` 或 `location`：

```nginx
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=admin_api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=bilibili_feed:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=bilibili_image:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=resource_download:10m rate=20r/m;
limit_conn_zone $binary_remote_addr zone=admin_conn:10m;
limit_conn_zone $binary_remote_addr zone=public_conn:10m;
```

## 8. Nginx 站点配置

保留实际证书路径。Express 已提供静态产物和 SPA 回退，因此所有页面也应代理到 Express。

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name utopiap.top www.utopiap.top;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name utopiap.top www.utopiap.top;

    ssl_certificate /etc/letsencrypt/live/utopiap.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/utopiap.top/privkey.pem;

    include /etc/nginx/snippets/utopia-security.conf;

    client_header_timeout 15s;
    client_body_timeout 30s;
    send_timeout 120s;

    location = /admin {
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
        include /etc/nginx/snippets/utopia-security.conf;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
    }

    location ^~ /admin/ {
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
        include /etc/nginx/snippets/utopia-security.conf;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
    }

    location = /api/admin/auth/login {
        client_max_body_size 16k;
        limit_req zone=admin_login burst=3 nodelay;
        limit_conn admin_conn 5;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 15s;
        proxy_read_timeout 15s;
    }

    location /api/admin/ {
        client_max_body_size 101m;
        limit_req zone=admin_api burst=20 nodelay;
        limit_conn admin_conn 5;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    location = /api/bilibili/feed {
        limit_req zone=bilibili_feed burst=10 nodelay;
        limit_conn public_conn 4;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 15s;
        proxy_read_timeout 15s;
    }

    location = /api/bilibili/image {
        limit_req zone=bilibili_image burst=30 nodelay;
        limit_conn public_conn 8;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 15s;
        proxy_read_timeout 15s;
    }

    location ~ ^/api/resources/[^/]+/download$ {
        limit_req zone=resource_download burst=10 nodelay;
        limit_conn public_conn 4;

        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location /uploads/ {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        include /etc/nginx/proxy_params;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Nginx 的 `add_header` 在子级 `location` 中出现后不会继承父级 `add_header`，因此管理页面设置 `Cache-Control` 时必须重新包含安全响应头片段。

应用配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 9. 防火墙与反向代理边界

在云安全组中只允许必要的管理端口以及公网 `80`、`443`。主机防火墙同样不得允许公网连接 `8787`。

外部网络检查应连接失败：

```bash
curl --max-time 5 http://utopiap.top:8787/api/health
```

服务器本机访问 `127.0.0.1:8787` 应正常。若前方还有 CDN 或负载均衡器，必须重新计算 `TRUST_PROXY_HOPS`，不能继续机械使用 `1`。

## 10. 发布后验收

```bash
curl -sSI http://utopiap.top/
curl -sSI http://www.utopiap.top/
curl -sS -D - -o /dev/null https://utopiap.top/
curl -sS -D - -o /dev/null https://utopiap.top/admin
curl -sS https://utopiap.top/api/health
curl -sS https://utopiap.top/build-info.json
curl -sS https://utopiap.top/api/bilibili/cache-stats
curl -sS -D - -o /dev/null https://utopiap.top/api/bilibili/feed
```

验收要求：

- HTTP 永久跳转 HTTPS，两个域名证书有效。
- HTTPS 返回 HSTS、强制 CSP、`nosniff`、`DENY`、Referrer Policy 和 Permissions Policy。
- `/admin` 返回 `Cache-Control: no-store`，页面不能被 iframe 嵌入。
- `/api/health` 返回 `{"ok":true}`。
- `/build-info.json` 对应本次发布提交且 `dirty` 为 `false`。
- `/api/bilibili/cache-stats` 返回 `200`，不包含 Cookie 或上游敏感信息。
- 同步响应包含 `X-Feed-Cache`，图片响应包含 `X-Image-Cache`。
- 首页、文章、视频封面、动态、管理登录、Markdown 预览、上传和下载功能正常。
- 浏览器控制台没有 CSP 违规或脚本错误。

## 11. 回滚

回滚必须使用上一个已经通过 CI 且保留完整 `build-info.json` 的发布版本：

1. 保持 `APP_STORAGE_ROOT` 不变，不回滚或覆盖运行时数据。
2. 切换应用工作目录或服务指向上一个已验证版本。
3. 执行 `DEPLOY_COMMIT=上一个提交SHA npm run verify:build`。
4. 重启服务并重复全部发布后验收。
5. 记录回滚提交、原因、时间和数据兼容性检查结果。

如果新版本已经改变内容数据结构，必须先确认向后兼容或使用经过验证的数据迁移回滚方案，不能仅替换代码。

## 12. 验收状态与后续待办

截至 2026-09-30：

- [x] 3.5 HTTPS、安全响应头、强制 CSP、管理页禁用缓存和公网端口隔离已通过生产检查。
- [x] 3.6 Bilibili 代理、缓存指标、危险目标拒绝和资源限制已通过生产检查。
- [x] 3.7 后台读取、内容保存、输入校验和版本冲突已通过生产冒烟测试。
- [x] 3.8 生产构建可追溯到 `6137eed8847666683fa58f605eb83ad329c0b74d`，且 `dirty: false`。
- [x] `main` 规则要求 `Security and reproducible build / verify` 与 `CodeQL / analyze` 成功后才能合并。
- [x] 3.9 采用 journald 本地留存方案；确认生产服务器不配置 `SECURITY_ALERT_WEBHOOK_URL`，不启用主动外发。
- [x] 3.10 已按本机加密备份方案通过生产验收：首份备份、完整性校验和首次真实恢复演练均完成；暂不配置离机副本的风险已记录并接受。

PR #1 会将视频封面改回浏览器直连 Bilibili CDN 并移除服务端图片代理，会破坏 3.6 的安全边界且与当前 CSP 冲突，不应按现状合并。
