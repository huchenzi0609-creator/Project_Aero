# 服务器运维手册（M9 交接文档）

> 本文件是部署/运维的**唯一权威交接**。M9 与后续任何运维者以此为准，另见 `docs/deploy.md`（通用部署手册）。

## 1. 服务器与访问

- **公网 IP**：116.62.121.70（阿里云轻量应用服务器，宝塔 Linux 面板）
- **系统**：Alibaba Cloud Linux 3 (OpenAnolis)，x86_64，2C/2G，40G 磁盘
- **SSH 登录**：用户 `admin`（**免密 sudo**）；部署私钥在本机 `/Users/huchenzi/.ssh/aero_deploy_ed25519`（公钥注释 `aero-deploy@feijisha.online`；已加入 `/home/admin/.ssh/authorized_keys`）。root 未配置密钥，**无需 root**。
- 连接示例：
  ```bash
  ssh -o BatchMode=yes -i ~/.ssh/aero_deploy_ed25519 admin@116.62.121.70 '命令'
  ```
- 撤销访问：删除服务器 `/home/admin/.ssh/authorized_keys` 中 `aero-deploy@feijisha.online` 行。

## 2. 部署清单（2026-08-31 实况）

| 项 | 位置/说明 |
|---|---|
| 应用代码 | `/opt/aero`（v0.2.10；**注意：服务器端非 git 仓库**，由 tar 上传，见 §5） |
| 数据库 | `/opt/aero-data/aero.db`（node:sqlite；游客账号/战绩持久化） |
| 进程 | PM2 `aero-server`：cwd=/opt/aero，script=`apps/server/node_modules/.bin/tsx`，**interpreter=bash**，args=`apps/server/src/index.ts`，env `NODE_ENV=production PORT=3001 DATA_DIR=/opt/aero-data` |
| 开机自启 | systemd `aero.service`（admin 用户执行 `pm2 resurrect`，已 enable；**注意：2026-08-31 部署后未整机重启，开机 resurrect 尚未实测**——pm2 守护进程实为 21:08 手动启动，见 §4 重启条目） |
| Nginx | 站点 `/etc/nginx/conf.d/feijisha.conf`：`listen 80; listen 8080;`，root=`/opt/aero/apps/web/dist`，反代 `/api/`、`/socket.io/`（WebSocket 头）、`/health` → 127.0.0.1:3001 |
| 环境 | Node v24.20.0（`/opt/node`，软链 `/usr/local/bin/{node,npm,npx}`）、pnpm 11.24、PM2 7（npm 全局，registry=registry.npmmirror.com）、nginx 1.24（dnf `--disableexcludes=all`）、git 2.43；SELinux **disabled**；iptables/nftables 全 ACCEPT |

## 3. 域名与 ICP 备案（关键）

- 域名 `feijisha.online`，A 记录 → 116.62.121.70（已生效）。
- **ICP 备案已申请、未通过**。未通过期间，阿里云对**该域名的所有端口**HTTP 访问返回 403 备案拦截页（按 Host 拦截，与端口无关）。
- **备案通过前可玩地址**：`http://116.62.121.70:8080`（IP 直连不受拦截）。80/443 在阿里云安全组已放行（含 8080），"443 不通"是备案拦截而非未放行。
- **备案通过后待办（顺序执行）**：
  1. 确认 `curl http://feijisha.online/` 不再是 403 备案页；
  2. 申请证书（acme.sh 已装，`~/.acme.sh/acme.sh`，默认 CA=letsencrypt）：
     `~/.acme.sh/acme.sh --issue -d feijisha.online -d www.feijisha.online -w /opt/aero/apps/web/dist`
     （若 www 无 A 记录，先只 `-d feijisha.online`）
  3. 安装证书：`--install-cert` 到 `/etc/nginx/certs`（key/fullchain，权限 600/644）；
  4. nginx 加 `listen 443 ssl; ssl_certificate …; ssl_certificate_key …;` + `server` 80 块 `return 301 https://$host$request_uri;`（8080 保留），`nginx -t && systemctl reload nginx`；
  5. 验收：`curl https://feijisha.online/health`、`pnpm exec node scripts/pub-smoke.mjs https://feijisha.online`。

## 4. 日常运维

- 状态：`pm2 list`、`pm2 logs aero-server`、`curl http://127.0.0.1:3001/health`、`systemctl status nginx aero.service`
- 重启：`pm2 reload aero-server`；整机重启后 systemd 会自动 `pm2 resurrect`。**待办：首次整机重启后必查** `pm2 list` 确认 aero-server 恢复 online；若未恢复（dump 缺失或 unit 未触发），手动 `pm2 resurrect` 并排查 journalctl -u aero.service
- 备份：**已配置（2026-08-31）**——admin 用户 crontab 每日 04:00 执行 `cp /opt/aero-data/aero.db /home/admin/backup/aero-$(date +%F).db && find /home/admin/backup -name "aero-*.db" -mtime +30 -delete`（保留约 30 份），日志追加至 `/home/admin/backup/backup.log`。手动执行验证通过：`aero-2026-08-31.db` 为 SQLite 3.x 且 md5 与源库一致。手动备份：`cp /opt/aero-data/aero.db /home/admin/backup/aero-$(date +%F).db`
- 本机冒烟：`PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' pnpm exec node scripts/pub-smoke.mjs <baseUrl>`

## 5. 更新/回滚流程（服务器端非 git 仓库）

1. 本机：`cd /Users/huchenzi/Ready4AI/Project_Aero && tar --exclude='Aero/node_modules' --exclude='Aero/.git' --exclude='Aero/data' --exclude='Aero/apps/web/dist' -czf /tmp/aero-src.tar.gz Aero`
2. 上传解压：`scp /tmp/aero-src.tar.gz admin@116.62.121.70:/tmp/`，服务器上 `/tmp` 解压后 `cp -a aero-extract/Aero/. /opt/aero/`（**勿直接在 /opt 解压**，admin 无 /opt 写权限）
3. `/opt/aero`：`pnpm install && pnpm --filter @aero/web build`
4. `pm2 reload aero-server`；验证 `/health` 与 pub-smoke。
- 回滚 = 重新上传旧版本 tar 覆盖 + 重建 + reload；数据库不回滚（备份先行）。
- 可选：若用户把仓库推送到 GitHub，可在服务器 `git init` + 配置 remote 后改用 `git pull`（需用户确认远程为最新）。

## 6. 踩坑记录（都是本次实战验证过的）

1. **sudo 的 PATH**：`sudo npm` 找不到 node/npm——用全路径 `/usr/local/bin/npm` 或 `sudo env PATH=/usr/local/bin:$PATH npm …`。
2. **pnpm 的 tsx 位置**：不在根 `node_modules/.bin`，在 `apps/server/node_modules/.bin/tsx`；且它是 **bash shim**，PM2 必须配 `interpreter: 'bash'`，否则 `SyntaxError: Invalid or unexpected token`。
3. **dnf 装 nginx**：Alinux 3 默认 exclude 掉 nginx，需 `dnf --disableexcludes=all install -y nginx`。
4. **acme.sh**：官方 `get.acme.sh` 被墙——用 Gitee 镜像 `git clone https://gitee.com/neilpang/acme.sh.git` 后 `./acme.sh --install -m admin@feijisha.online`，再 `--set-default-ca --server letsencrypt`（默认 ZeroSSL 需额外注册）。
5. **ICP 拦截**：按 Host 域名全端口生效，证书 http-01 校验也因此 403；备案通过前一切公网验证走 IP。
6. **tar**：macOS 打包带 xattr 头，Linux 解压会打 "Ignoring unknown extended header" 警告，无害。
7. 修改 nginx/服务配置后务必 `nginx -t` / `systemctl daemon-reload`。

## 7. 本机相关

- 仓库：`/Users/huchenzi/Ready4AI/Project_Aero/Aero`（pnpm monorepo；部署相关：`docs/deploy.md`、本手册、`ecosystem.config.cjs`、`Dockerfile`、`scripts/pub-smoke.mjs`）。
- pnpm：`/Users/huchenzi/Ready4AI/Project_Aero/.tools/bin/pnpm`（PATH 前置使用）。
- 域名解析检查：`nslookup feijisha.online`；端口探测：`nc -z -G 4 116.62.121.70 <port>`。
- 访问分析工具（2026-09-01 新增）：`/Users/huchenzi/Ready4AI/Project_Aero/Analyze`（**独立 git 仓库**，main 分支，与 Aero 仓库无关）。SSH 增量抓取服务器 nginx 访问日志（时间/IP/IP 属地）入本地 SQLite，仪表盘可视化（时间-次数柱状图、属地饼图、灰度期统计白名单分类，支持筛选），地址 `http://127.0.0.1:3100`。启动：`npm install && npm run setup && npm start`；单次抓取 CLI：`npm run fetch`；白名单变更后 `node scripts/reclassify.js` 重算历史分类；配置见 `Analyze/config.json` 与 README。注意：私钥仅按路径引用（config.json `sshKey`），不复制密钥。
