# 飞机杀 (Project Aero) 宝塔 Linux 部署手册

> 适用：阿里云轻量应用服务器 + 宝塔 Linux 面板，域名 `feijisha.online`。
> 架构：宝塔 Node 环境 + PM2 运行游戏后端（3001，含前端静态托管）→ Nginx 对外 80/443（HTTPS）→ 域名访问。
> 主方案为 Node+PM2；备选方案 Docker（见文末）。

## 0. 前置准备（宝塔之外）

1. **域名解析**：在阿里云 DNS 控制台为 `feijisha.online` 添加 A 记录 → 服务器公网 IP（www 可选）。
2. **安全组**：阿里云控制台"轻量应用服务器 → 防火墙"放行 **80** 与 **443**（TCP）。宝塔面板端口（默认 8888）保持原样。
3. 确认服务器有 Node 可用环境（下一步装）。

## 1. 服务器环境

1. 宝塔面板 → 软件商店 → 安装 **Node.js 版本管理器**，装 **Node 22 或 24**（本游戏要求 ≥ 22.19，数据库用内置 node:sqlite）。
2. 命令行（宝塔终端）启用 pnpm：
   ```bash
   corepack enable
   pnpm --version   # 应输出 9.x/10.x/11.x
   ```
   若 `corepack` 不可用：`npm i -g pnpm`。
3. 软件商店 → 安装 **PM2 管理器**（用于守护进程）。
4. 软件商店确认 **Nginx** 已安装。

## 2. 上传代码

任选其一：

- **git**（若仓库已推送 GitHub）：
  ```bash
  cd /www/wwwroot
  git clone https://github.com/<你的仓库地址>.git aero
  cd aero && git checkout release/v0.2.6   # v0.2.10 所在分支（或用 git checkout v0.2.10 检出标签）
  ```
- **压缩包**：本地执行
  ```bash
  cd /Users/huchenzi/Ready4AI/Project_Aero && tar --exclude='Aero/node_modules' --exclude='Aero/.git' --exclude='Aero/data' -czf aero.tar.gz Aero
  ```
  把 `aero.tar.gz` 通过宝塔"文件"上传到 `/www/wwwroot` 并解压：`cd /www/wwwroot && tar -xzf aero.tar.gz`。

## 3. 安装依赖并构建前端

```bash
cd /www/wwwroot/Aero
pnpm install
pnpm --filter @aero/web build      # 生成 apps/web/dist（服务端会自动托管）
```

## 4. 启动后端（PM2）

```bash
mkdir -p /www/aero-data            # 数据库目录（推荐独立于代码，便于备份）
# 编辑 ecosystem.config.cjs，把 DATA_DIR 改为 /www/aero-data（或用环境变量覆盖）
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                        # 按提示执行输出的命令，实现开机自启
```

验证：`curl http://127.0.0.1:3001/health` 应返回 `{"ok":true,...}`；
`curl http://127.0.0.1:3001/` 应返回含 `<title>飞机杀</title>` 的页面（服务端已内置静态托管，无需 Nginx 也能跑；Nginx 用于 80/443 与 HTTPS）。

## 5. Nginx 站点与反向代理（推荐）

宝塔面板 → 网站 → 添加站点，域名填 `feijisha.online`，根目录随意（我们走反代）。编辑该站配置，替换 server 块为：

```nginx
server {
    listen 80;
    server_name feijisha.online www.feijisha.online;

    # 前端静态（也可以直接反代全部到 3001，因服务端内置静态托管；两种皆可）
    root /www/wwwroot/Aero/apps/web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 健康检查 / 身份 API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }

    # Socket.IO（含 WebSocket 升级）
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

> 若不想用 Nginx 托管静态：把 `location /` 也改成 `proxy_pass http://127.0.0.1:3001;`（服务端已内置 SPA 回退与静态托管）。

## 6. HTTPS

宝塔 → 网站 → 该站点 → SSL → Let's Encrypt → 勾选域名（需域名解析已生效）→ 申请并**开启强制 HTTPS**。证书自动续期由宝塔处理。

## 7. 防火墙

- 服务器/宝塔仅对外放行 **80、443**（3001 不对外，仅 Nginx 内网访问）。
- 阿里云安全组同样只放行 80/443。

## 8. 数据与备份

- 数据库：`DATA_DIR`（默认 `./data/aero.db`，推荐 `/www/aero-data/aero.db`），SQLite 单文件。
- 备份：`cp /www/aero-data/aero.db /www/backup/aero-$(date +%F).db`，可加宝塔计划任务每日执行。

## 9. 部署后验收清单

1. 本机 `curl https://feijisha.online/health` → `{"ok":true,...}`（HTTPS 生效后）。
2. 浏览器打开 `https://feijisha.online`：主页显示"飞机杀"，无控制台报错。
3. 两台设备同时打开：联机对战 → 局域网对局（此时实为公网经域名互通）→ 建房/入房 → 摆阵 → 对局 → 结算。
4. 断线重连：对局中刷新页面 → 圆形浮窗"回到未完成对局"可用。
5. `pm2 logs aero-server` 无异常报错。

## 10. 版本更新流程

```bash
cd /www/wwwroot/Aero
git pull && git checkout <目标分支/标签>
pnpm install
pnpm --filter @aero/web build
pm2 reload aero-server
```

## 11. 常见问题

- **WebSocket 502**：Nginx 的 `/socket.io/` 块缺少 `proxy_http_version 1.1` 与 Upgrade/Connection 头（见 §5）。
- **pnpm: command not found**：`corepack enable` 或 `npm i -g pnpm`。
- **Node 版本过低**（`node:sqlite` 报错）：需 Node ≥ 22.19，宝塔 Node 版本管理器切换。
- **字体加载慢**：页面字体走 jsdelivr CDN，国内可能偏慢；有 system-ui 回退不影响可用。如需本地化字体（自托管 LXGW WenKai），可后续处理。
- **端口占用**：`pm2 logs` 查看；改 PORT 需同步 ecosystem 与 Nginx。
- **数据库写失败**：确认 DATA_DIR 目录存在且 PM2 用户可写。

## 12. 备选：Docker

服务器装好 Docker 后：

```bash
cd /www/wwwroot/Aero
docker build -t aero .
docker run -d --restart unless-stopped --name aero -p 3001:3001 \
  -v /www/aero-data:/app/data aero
```

Nginx 配置同上（反代 127.0.0.1:3001）；HTTPS 同 §6。

## 13. 需要我远程代部署？

我没有你的服务器访问权限。两种方式：
1. 你按本手册操作（推荐先试，遇到报错把输出发我）；
2. 给我 SSH 访问（建议用部署公钥：我生成密钥对，你把我提供的公钥加到服务器 `~/.ssh/authorized_keys`，并告知服务器 IP），我可远程执行全部部署步骤并验证。

## 14. 本次线上部署纪要（2026-08-31，阿里云轻量 + 宝塔）

- 服务器：Anolis 3 x86_64，2C/2G；Node v24.20.0（/opt/node，二进制安装）、pnpm 11.24、PM2 7（npm 全局，registry=registry.npmmirror.com）；nginx 1.24（dnf 需 `--disableexcludes=all`）；SELinux 已禁用。
- 应用：代码 /opt/aero（v0.2.10），数据库 /opt/aero-data；PM2 进程 aero-server（`script: apps/server/node_modules/.bin/tsx` + `interpreter: bash`）；开机自启 = systemd `aero.service`（以 admin 用户 `pm2 resurrect`）。
- Nginx：站点 feijisha.conf（80 + 8080 双监听），静态 /opt/aero/apps/web/dist + `/api/`、`/socket.io/`、`/health` 反代 127.0.0.1:3001。
- **ICP 备案拦截（重要）**：域名 `feijisha.online` 备案未通过前，阿里云对**该域名的任何端口**HTTP 访问都返回备案拦截页（403）；期间可经 **IP 直连**（http://<服务器IP>:8080）正常游玩。备案通过后恢复 80/443 并申请 Let's Encrypt（acme.sh 经 Gitee 镜像安装，默认 CA 已设 letsencrypt）。
- 证书（备案通过后执行）：`~/.acme.sh/acme.sh --issue -d feijisha.online -d www.feijisha.online -w /opt/aero/apps/web/dist --server letsencrypt`，安装到 /etc/nginx/certs 并启用 443 + 80→443 跳转。
- 冒烟脚本：`scripts/pub-smoke.mjs <baseUrl>`（线上页面/摆阵/控制台错误检查）。
