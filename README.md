# GitAgent Desktop (MVP)

基于你提供的 PRD（V1.0）实现的首版 MVP：

- GitHub 登录（MVP 用 PAT，Token 存系统 Keychain）
- 仓库列表与 Issue 列表/详情浏览、筛选
- 一键发起 AI 任务（Bug Fix / Feature）
- 自动执行：Fork -> 分支 -> Clone -> Claude Code
- 实时日志展示、任务队列（串行执行）
- 变更文件勾选确认 -> commit/push -> 创建 PR

## 技术栈

- Electron + React + TypeScript + Vite
- Zustand（渲染层状态）
- Octokit（GitHub API）
- simple-git（Git 操作）
- keytar（安全存储 Token）

## 快速启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
export ANTHROPIC_API_KEY=your_key
# 可选：最低 claude 版本要求
export CLAUDE_MIN_VERSION=0.2.0
```

3. 启动开发模式

```bash
npm run dev
```

## 使用流程

1. 启动后输入 GitHub PAT 登录（至少 `repo`, `workflow` 权限）
2. 选择仓库，筛选并打开目标 Issue
3. 点击 `AI 修复` 或 `AI 开发`
4. 任务进入队列并自动执行，右侧实时查看日志
5. 到 `待提交` 状态后勾选文件并确认提交
6. 系统自动 push 并创建 PR，返回 PR 链接

## 当前 MVP 限制

- 登录先采用 PAT（未接 GitHub OAuth loopback 全流程）
- Prompt 自定义、多账号切换、通知系统尚未实现
- Markdown 安全渲染未加 DOM sanitizer（MVP）
- 依赖本机已安装 `git` 与 `claude` CLI

## 目录结构

```text
src/
  main/
    claude/
    git/
    github/
    ipc/
    queue/
    index.ts
    preload.ts
  renderer/
    store/
    App.tsx
    main.tsx
    styles.css
  shared/
    api.ts
    types.ts
```
