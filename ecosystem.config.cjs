/**
 * PM2 进程配置（宝塔 PM2 管理器 / 命令行均可使用）
 * 启动：pm2 start ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'aero-server',
      cwd: __dirname,
      script: 'node_modules/.bin/tsx',
      args: 'apps/server/src/index.ts',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // 建议改为独立目录便于备份，如 /www/aero-data（目录需已存在且可写）
        DATA_DIR: './data',
      },
      // 应用异常自动重启；内存超限保护
      max_restarts: 10,
      max_memory_restart: '512M',
      time: true,
    },
  ],
}
