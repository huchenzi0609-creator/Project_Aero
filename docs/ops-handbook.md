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

## 2. 部署清单（2026-09-07 实况：**双通道 / 8080 分流**）

| 项 | 位置/说明 |
|---|---|
| 根通道 `/` | `/opt/aero-old`（**v0.2.10-alpha**；由 `/opt/aero.bak.v0210` 克隆，node_modules 复用）；PM2 **`aero-server`** :3001，DATA_DIR=`/opt/aero-data`（游客数据连续性）。**本次部署不动** |
| beta 通道 `/beta/` | `/opt/aero-beta`（**v0.3.11**，2026-09-07 由 v0.3.9 升级；dist 为 `vite build --base=/beta/` 产物）；PM2 **`aero-server-beta`** :3002，DATA_DIR=`/opt/aero-data-beta`（2026-09-06 从主库种子，隔离增长） |
| 双实例 PM2 配置 | `/home/admin/ecosystem.config.cjs`（两个 app；**文件名必须是 ecosystem.config.cjs 才被 PM2 识别为多 app 配置**，见 §6 坑 8）；`pm2 save` 已含两实例 |
| 数据库 | 主库 `/opt/aero-data/aero.db`（根通道）；beta 独立库 `/opt/aero-data-beta/aero.db` |
| 历史备份/回滚点 | 代码：`/opt/aero.bak.v0210`（v0.2.10 整树）、`/opt/aero-beta.bak.v037alpha`（v0.3.7-alpha）、`/opt/aero-beta.bak.v039`（v0.3.9，**当前 beta 回滚点**）；`/home/admin/backup/`：`aero-v037-base-dist-2026-09-06-2326`（base=/ v0.3.7 dist）、`aero-beta-predeploy-v0311-2026-09-07-2251.db`（beta DB 快照）等；nginx 旧配置 `/etc/nginx/conf.d/feijisha.conf.bak-dual-2026-09-06-2328`、`feijisha.conf.bak-https-2026-09-08-1808`（HTTPS 改造前） |
| Nginx | `/etc/nginx/conf.d/feijisha.conf`（**三块监听：443 ssl http2 / 80→301 / 8080 备用**，双通道分流一致）：根通道 root=`/opt/aero-old/apps/web/dist` + `/api/`、`/socket.io/`、`/health` 反代 3001；`/beta/` 静态 alias `/opt/aero-beta/apps/web/dist/`（SPA try_files）+ `/beta/api/`、`/beta/socket.io/`（去前缀）、`/beta/health` 反代 3002；`= /beta` → 301 `/beta/`；80 保留 `/.well-known/acme-challenge/` 豁免 |
| 开机自启 | systemd `aero.service`（admin 用户执行 `pm2 resurrect`，已 enable；**仍未经真实整机重启实测**——dump 现含两实例，见 §4 重启条目） |
| 环境 | Node v24.20.0（`/opt/node`，软链 `/usr/local/bin/{node,npm,npx}`）、pnpm 11.24、PM2 7（npm 全局，registry=registry.npmmirror.com）、nginx 1.24（dnf `--disableexcludes=all`）、git 2.43；SELinux **disabled**；iptables/nftables 全 ACCEPT |

**冒烟脚本分工（本机）**：`scripts/pub-smoke.mjs <base> [版本]`（主流程/默认 beta v0.3.11）、`scripts/pub-smoke-v0210.mjs <base>`（根通道 v0.2.10）、`scripts/e2e-beta-room.mjs <base>`（beta 联机建房+加入 E2E）、`scripts/spot-v0311.mjs <base>`（v0.3.11 新改动抽查：无跳过按钮/横屏气泡/竖屏 cell 尺寸）。

## 3. 域名 / ICP / HTTPS（2026-09-08 已完成）

- 域名 `feijisha.online` 与 `www.feijisha.online`，A 记录 → 116.62.121.70（www 与主域均有记录）。
- **ICP 备案 2026-09-08 已通过**，域名 HTTP 不再被阿里云 403 拦截。
- **HTTPS 已启用（2026-09-08）**：证书 Let's Encrypt（acme.sh v3.1.3，Gitee 安装，默认 CA letsencrypt，账号 admin@feijisha.online），SAN = feijisha.online + www.feijisha.online；有效期 2026-09-08 → 2026-12-07，**续期由 admin crontab 每日 06:02 acme.sh --cron 自动执行**（webroot http-01 → /opt/aero-old/apps/web/dist，nginx 80 已保留 `/.well-known/acme-challenge/` 豁免不跳转）。
- **nginx 三块监听**（/etc/nginx/conf.d/feijisha.conf）：
  - `80`：全量 `return 301 https://$host$request_uri`（含 /beta 路径保留）；
  - `443 ssl http2`：双通道分流与 8080 完全一致（根 → 3001，/beta 静态+反代 → 3002，/socket.io 与 /beta/socket.io 均走 TLS/wss）；
  - `8080`：IP 直连 HTTP 备用通道，保持原样不跳转（默认行为，如需 8080 也 301 需组长确认）。
- 证书文件：`/etc/nginx/certs/feijisha.online.pem`（644）/ `feijisha.online.key`（600），目录 admin 所有（便于 acme 续期写入）。签发：`~/.acme.sh/acme.sh --issue -d feijisha.online -d www.feijisha.online -w /opt/aero-old/apps/web/dist`；安装：`--install-cert -d feijisha.online --ecc --key-file … --fullchain-file …`。
- 验收基线：`https://feijisha.online/`（角标 v0.2.10）、`https://feijisha.online/beta`（角标 v0.3.11）、`pub-smoke` 双通道、wss 握手、e2e-beta-room——2026-09-08 已全部通过；`http://IP:8080` 回归不受影响。

## 4. 日常运维

- 状态：`pm2 list`、`pm2 logs aero-server` / `aero-server-beta`、`curl http://127.0.0.1:3001/health`、`curl http://127.0.0.1:3002/health`、`systemctl status nginx aero.service`
- 重启：`pm2 reload aero-server`；整机重启后 systemd 会自动 `pm2 resurrect`。**待办：首次整机重启后必查** `pm2 list` 确认 aero-server 恢复 online；若未恢复（dump 缺失或 unit 未触发），手动 `pm2 resurrect` 并排查 journalctl -u aero.service
- 备份：**已配置（2026-08-31）**——admin 用户 crontab 每日 04:00 执行 `cp /opt/aero-data/aero.db /home/admin/backup/aero-$(date +%F).db && find /home/admin/backup -name "aero-*.db" -mtime +30 -delete`（保留约 30 份），日志追加至 `/home/admin/backup/backup.log`。手动执行验证通过：`aero-2026-08-31.db` 为 SQLite 3.x 且 md5 与源库一致。手动备份：`cp /opt/aero-data/aero.db /home/admin/backup/aero-$(date +%F).db`
- 本机冒烟：`PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' pnpm exec node scripts/pub-smoke.mjs <baseUrl>`

## 5. 更新/回滚流程（服务器端非 git 仓库）

**部署实操要点（2026-09-06 v0.3.7 验证过）：**
- 依赖零变化时可**本地构建 dist 并随 tar 上传**（tar 含 apps/web/dist），服务器**无需 pnpm install/build**，node_modules 用"整树克隆旧目录再覆盖新代码"的方式复用。
- 标准步骤：① DB 手动备份 `cp /opt/aero-data/aero.db /home/admin/backup/aero-predeploy-$(date +%F-%H%M).db`；② `sudo mv /opt/aero /opt/aero.bak.v<旧版本>`（建立回滚点，先确认该名不存在）；③ `/tmp` 解压新 tar（以 admin 解压保持所有权）；④ `sudo cp -a /opt/aero.bak.v<旧版本> /opt/aero`（克隆含 node_modules）；⑤ `sudo cp -a /tmp/解压目录/Aero/. /opt/aero/` 覆盖新代码+dist；⑥ 完整性检查（tsx 路径 / dist 角标 / package.json 版本）；⑦ `pm2 restart aero-server`（**勿用 --update-env**，会覆盖 DATA_DIR）；⑧ 验证 /health 与 pub-smoke，DB md5 复检（应与部署前一致）。
- 回滚 = `sudo mv /opt/aero.bak.v<旧版本> /opt/aero` + `pm2 restart aero-server` + 验证；数据库不回滚（备份先行）。
- 服务器现役 node_modules 复用前提：新版本无新增依赖（对比 `git diff v<旧tag> HEAD -- package.json apps/*/package.json`）。

1. 本机：`cd /Users/huchenzi/Ready4AI/Project_Aero && tar --exclude='Aero/node_modules' --exclude='Aero/.git' --exclude='Aero/data' -czf /tmp/aero-src.tar.gz Aero`（dist 已本地构建时**不要**排除 apps/web/dist）
2. 上传解压：`scp /tmp/aero-src.tar.gz admin@116.62.121.70:/tmp/`，服务器上 `/tmp` 解压后按上述实操要点覆盖（**勿直接在 /opt 解压**，admin 无 /opt 写权限，用 sudo mv/cp）
3. `pm2 restart aero-server`；验证 `/health` 与 pub-smoke。
- **双通道 beta-only 更新（2026-09-07 v0.3.9 验证）**：仅动 `/opt/aero-beta` 与 `aero-server-beta`——`sudo mv /opt/aero-beta /opt/aero-beta.bak.v<旧版>` → `sudo cp -a <bak> /opt/aero-beta`（克隆复用 node_modules）→ `sudo cp -a /tmp/解压/Aero/. /opt/aero-beta/`（覆盖新代码 + `--base=/beta/` dist）→ `chown -R admin:admin` → `pm2 restart aero-server-beta`（勿 --update-env）→ 验证 `/beta/health`、角标、`/beta/socket.io` 握手、e2e-beta-room；beta DB md5 应与部署前一致。根通道 aero-server/nginx 分流一律不动。
- 可选：若用户把仓库推送到 GitHub，可在服务器 `git init` + 配置 remote 后改用 `git pull`（需用户确认远程为最新）。

## 6. 踩坑记录（都是本次实战验证过的）

1. **sudo 的 PATH**：`sudo npm` 找不到 node/npm——用全路径 `/usr/local/bin/npm` 或 `sudo env PATH=/usr/local/bin:$PATH npm …`。
2. **pnpm 的 tsx 位置**：不在根 `node_modules/.bin`，在 `apps/server/node_modules/.bin/tsx`；且它是 **bash shim**，PM2 必须配 `interpreter: 'bash'`，否则 `SyntaxError: Invalid or unexpected token`。
3. **dnf 装 nginx**：Alinux 3 默认 exclude 掉 nginx，需 `dnf --disableexcludes=all install -y nginx`。
4. **acme.sh**：官方 `get.acme.sh` 被墙——用 Gitee 镜像 `git clone https://gitee.com/neilpang/acme.sh.git` 后 `./acme.sh --install -m admin@feijisha.online`，再 `--set-default-ca --server letsencrypt`（默认 ZeroSSL 需额外注册）。
5. **ICP 拦截**：按 Host 域名全端口生效，证书 http-01 校验也因此 403；备案通过前一切公网验证走 IP。
6. **tar**：macOS 打包带 xattr 头，Linux 解压会打 "Ignoring unknown extended header" 警告，无害。
7. 修改 nginx/服务配置后务必 `nginx -t` / `systemctl daemon-reload`。
8. **PM2 ecosystem 文件名**：多 app 配置文件**必须命名 `ecosystem.config.cjs`（或 ecosystem.config.js 等 PM2 约定名）**；命名 `xxx.ecosystem.cjs` 之类不会被识别为配置，PM2 会当普通脚本启动出伪进程（名字变 xxx.ecosystem，apps 数组不生效、端口无监听）。换名后 `pm2 start <文件>` 即正常。
9. **`vite build --base`**：给子路径部署构建 web 必须显式 `--base=/beta/`（产物资源前缀 `/beta/`）；socket 路径由客户端 `import.meta.env.BASE_URL` 推导（根=`/socket.io`，beta=`/beta/socket.io`），nginx 侧 `/beta/socket.io/` 去前缀反代到 beta 后端默认 `/socket.io/`。
10. **运维脚本跨分支**：ops 脚本（pub-smoke 系列、e2e-beta-room）按纪律提交在"当时当前分支"，分支切换后新分支可能没有这些文件——发现缺失用 `git checkout <旧分支> -- scripts/xxx.mjs` 并回，勿重复手写。

## 7. 本机相关

- 仓库：`/Users/huchenzi/Ready4AI/Project_Aero/Aero`（pnpm monorepo；部署相关：`docs/deploy.md`、本手册、`ecosystem.config.cjs`、`Dockerfile`、`scripts/pub-smoke.mjs`）。
- pnpm：`/Users/huchenzi/Ready4AI/Project_Aero/.tools/bin/pnpm`（PATH 前置使用）。
- 域名解析检查：`nslookup feijisha.online`；端口探测：`nc -z -G 4 116.62.121.70 <port>`。
- 访问分析工具（2026-09-01 新增）：`/Users/huchenzi/Ready4AI/Project_Aero/Analyze`（**独立 git 仓库**，main 分支，与 Aero 仓库无关）。SSH 增量抓取服务器 nginx 访问日志（时间/IP/IP 属地）入本地 SQLite，仪表盘可视化（时间-次数柱状图、属地饼图、灰度期统计白名单分类，支持筛选），地址 `http://127.0.0.1:3100`。启动：`npm install && npm run setup && npm start`；单次抓取 CLI：`npm run fetch`；白名单变更后 `node scripts/reclassify.js` 重算历史分类；配置见 `Analyze/config.json` 与 README。注意：私钥仅按路径引用（config.json `sshKey`），不复制密钥。
