#!/usr/bin/env bash
# e2e-local.sh —— 本机 e2e 一键运行（v0.3.15 验证协议配套）
#
# 解决三类踩坑：
#  1) 忘带 PLAYWRIGHT_CHROMIUM_EXECUTABLE → 整轮 "Executable doesn't exist" 白跑；
#  2) 重复 dev server（多个 vite/tsx）抢端口或让 Playwright 复用到旧实例；
#  3) 需要确定性 AI 行为时忘记注入种子。
#
# 用法：
#   scripts/e2e-local.sh                # 全量 e2e（单实例 dev server + 确定性种子）
#   scripts/e2e-local.sh e2e/tutorial.spec.ts   # 只跑指定 spec（推荐给功能 agent）
#   E2E_SEED=0 scripts/e2e-local.sh     # 关闭确定性种子（随机 AI，贴近真实手感）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1) 固定的 Chromium 可执行文件（本机无 headless-shell）
DEFAULT_CHROME="/Users/huchenzi/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$DEFAULT_CHROME}"
if [ ! -e "$PLAYWRIGHT_CHROMIUM_EXECUTABLE" ]; then
  echo "✗ Chromium 不存在：$PLAYWRIGHT_CHROMIUM_EXECUTABLE" >&2
  echo "  请设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE 或安装：pnpm exec playwright install chromium" >&2
  exit 1
fi

# 2) 确定性种子（e2e 通过 localStorage.aero.e2eSeed 读取；0 = 关闭）
export E2E_SEED="${E2E_SEED:-20260912}"

# 3) dev server 单例化：同端口的重复进程只保留一个
cleanup_dupes() {
  local pattern="$1" port="$2"
  local pids keeper
  pids=$(pgrep -f "$pattern" || true)
  [ -z "$pids" ] && return 0
  keeper=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -z "$keeper" ]; then
    keeper=$(echo "$pids" | head -1)
  fi
  for pid in $pids; do
    if [ "$pid" != "$keeper" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
cleanup_dupes "vite/bin/vite.js" 5173
cleanup_dupes "tsx/dist/cli.mjs watch src/index.ts" 3001

# 4) 运行（Playwright webServer 会按需拉起/复用 5173 与 3001）
export PATH="/Users/huchenzi/Ready4AI/Project_Aero/.tools/bin:$PATH"
if [ "$#" -gt 0 ]; then
  echo "▶ e2e 指定 spec：$*（seed=${E2E_SEED}）"
  exec pnpm exec playwright test "$@"
fi
echo "▶ e2e 全量（seed=${E2E_SEED}）"
exec pnpm e2e
