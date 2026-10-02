# Alibaba Cloud Linux 4 全新安装

`install-alinux4.sh` 为本项目安装完整的单实例网站。适用于运行 systemd 的 Alibaba Cloud Linux 4，支持 x86_64 和 aarch64。它不是已有生产服务器的升级或数据迁移脚本，也不会改善服务器地域导致的网络延迟。

## 安装前准备

1. 准备全新 ECS 实例。安全组开放 TCP 80/443，保留你的 SSH 访问规则，不开放 8787。
2. 准备域名及覆盖主域名、www 域名的有效 PEM 证书完整链和私钥，上传到服务器。安装脚本复制证书，不自动签发或续期。
3. 确认当前系统配置的官方软件仓库提供 `nginx`、`clamav` 和 `clamav-update`。缺包时安装会中止，不自动加入其他发行版的仓库。可先执行 `sudo dnf info nginx clamav clamav-update`。
4. 将包含本安装脚本、经过审核的提交推送到仓库，再在服务器克隆。构建要求干净的 Git 工作区。私有仓库使用你已有的 Git 认证方式。

```bash
sudo dnf install -y git
git clone https://github.com/defixers/VocaloidProducerBlog.git
cd VocaloidProducerBlog
git checkout <经过审核的完整提交SHA>
sudo bash deploy/install-alinux4.sh
```

按提示填写域名、证书绝对路径、私钥绝对路径及管理密码。只有一个域名时，将第二个域名填为同一个域名。密码隐藏输入且至少 12 字符。也可预设非敏感参数：

```bash
sudo env DOMAIN=utopiap.top WWW_DOMAIN=www.utopiap.top \
  TLS_CERT=/root/certs/fullchain.pem TLS_KEY=/root/certs/privkey.pem \
  bash deploy/install-alinux4.sh
```

脚本会安装系统软件，启用 SELinux 的 HTTP 网络连接布尔开关（若 SELinux 已启用），并为正在运行的 firewalld 添加 HTTP/HTTPS 服务规则。不会自动启用未运行的 firewalld、修改 SSH 规则或修改阿里云安全组。

## 自动完成的工作

- 从 `.nvmrc` 读取 Node 精确版本，下载官方运行时并校验官方 SHA-256 清单；使用 `package.json` 指定的 npm 版本。
- 创建独立构建账户 `vpb-build`，以普通权限安装锁定依赖，执行安全测试、依赖审计、双构建与来源验证，之后将源码收回 root 所有。
- 创建无登录应用账户 `vpb`、Argon2id 管理密码、独立日志脱敏密钥和生产环境文件。
- 将运行数据放在 `/var/lib/vocaloid-producer-blog`，不放入 Git 工作区。
- 安装 Nginx HTTPS 反向代理、安全响应头、后台禁用缓存和登录限流；其他 API 的限流由应用执行。
- 创建 nftables 独立规则表，阻止非回环接口访问 8787，并让应用依赖该防护服务启动。
- 安装 ClamAV，首次更新病毒库，启用每六小时更新定时器。
- 安装独立 `vpb-backup` 账户和 root 所有的备份程序，生成 AES-256-GCM 备份密钥，执行首次备份、恢复演练，启用每 12 小时备份及每月演练。
- 校验 systemd 和 Nginx 配置，并通过本机 HTTPS 请求验证证书链、域名和健康接口。

## 目录与运维

| 内容 | 路径 |
| --- | --- |
| 代码、依赖和构建产物 | `/opt/vocaloid-producer-blog` |
| 应用配置 | `/opt/vocaloid-producer-blog/.env` |
| 文章和上传资源 | `/var/lib/vocaloid-producer-blog` |
| TLS 证书及备份配置/密钥 | `/etc/vocaloid-producer-blog` |
| 加密备份 | `/var/backups/vocaloid-producer-blog` |
| 备份程序 | `/opt/vocaloid-producer-blog-backup` |
| Nginx 站点 | `/etc/nginx/conf.d/vocaloid-producer-blog.conf` |

```bash
sudo systemctl status vocaloid-producer-blog nginx vpb-port-guard
sudo journalctl -u vocaloid-producer-blog -n 100 --no-pager
sudo systemctl list-timers 'vocaloid-producer-blog-*' 'vpb-*'
sudo nft list table inet vpb_guard
```

将备份密钥保存到服务器之外的受控密码库。本安装默认只有本机加密副本；离机备份可按主部署文档配置独立 rclone 账户及 root 所有的 `backup.env`，启用后设置 `BACKUP_REQUIRE_REPLICA=true`，再验证备份及恢复。

需要 Bilibili Cookie 时，用 `sudoedit /opt/vocaloid-producer-blog/.env` 填写 `BILIBILI_COOKIE`，再重启应用。不要添加 `VITE_` 前缀。告警默认由 journald 留存，不外发。

证书续期后替换 `/etc/vocaloid-producer-blog/fullchain.pem` 与 `privkey.pem`，保持私钥为 root 所有、权限 0600，执行 `sudo nginx -t` 和 `sudo systemctl reload nginx`。这部分需要维护者或另行配置的证书管理工具负责。

## 迁移和最终验收

安装只初始化仓库的空内容。迁移旧服务器时，应先备份并通过既有恢复工具将数据恢复到临时空目录，核验后停机切换，恢复所有者、权限和备份 ACL，再切换 DNS。不要直接覆盖正在运行的 `content.json` 或上传目录。

DNS 指向新服务器后，从服务器之外的电脑运行项目已有的只读冒烟检查：

```bash
DEPLOY_COMMIT=<安装的完整提交SHA> \
SMOKE_BASE_URL=https://utopiap.top SMOKE_WWW_URL=https://www.utopiap.top \
node scripts/smoke-production.mjs
```

必须从外部验证 8787 隔离；服务器自身访问其公网地址不能替代外部验证。随后手动检查后台登录、文章保存、Bilibili 同步和上传下载。

安装中断时保留已生成配置和日志，并报告失败行号；脚本不自动清空目录或回滚系统包。修复失败步骤或换用全新实例后再执行，不要通过删除已有生产数据来绕过检查。后续发布按 `PRODUCTION_DEPLOYMENT.md` 完成备份、干净构建、切换和回滚；运行账户为 `vpb`，不是文档旧示例中的 `admin`。

当前脚本已纳入仓库 Bash 语法检查；Windows 开发环境无法代替真实 Alibaba Cloud Linux 4 的系统包、SELinux、nftables 和 systemd 集成验收。
