# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 仓库初始化：pnpm monorepo（apps/web、apps/server、packages/game-core、packages/shared）
- 安装 AgentTeams 插件（@nanmicoder/dsh-agent-teams ^0.1.14）至 web profile
- docs/design.md：经用户确认的修订版设计定稿
- docs/game-core-api.md：game-core 公开 API 契约
- docs/handoff-m4-m6-m7.md：M4/M6/M7 交接规格
- packages/shared：协议类型、zod schema、默认飞机形状、计时常量、游客 token 键、房码长度、gameEnd 统计契约
- M3 纸感设计系统：纸纹理/组件库/PlaneGlyph/StampMark/PaperGrid + 主页/单机菜单/自定义编辑器/设置/规则/联机菜单/对局占位页 + 横竖版响应式
- ESLint / Prettier / CI / Playwright e2e 基建

### Changed

- 后端数据库采用 Node 内置 node:sqlite（替代 better-sqlite3，免原生编译）

## [0.1.0] - 待发布

- 首个可玩版本（计划内：单机三档 + 自定义模式 + 联机 + 四级 AI + 纸感 UI）
