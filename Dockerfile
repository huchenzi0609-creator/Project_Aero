# 飞机杀 (Project Aero) 生产镜像（备选方案；主方案见 docs/deploy.md 的 Node+PM2）
FROM node:24-slim

RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @aero/web build

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data

EXPOSE 3001
CMD ["pnpm", "--filter", "@aero/server", "start"]
