# BuildBot Desktop

> GitHub Issue -> AI 执行 -> Review -> 分支 / PR 的桌面端自动化工作台。  
> 仓库中部分历史命名仍保留 `gitagent-desktop`，当前对外文档统一使用 `BuildBot Desktop`。

BuildBot Desktop 是一个基于 Electron 的本地桌面应用，用来把 GitHub 仓库里的 Issue 转成可执行的开发任务。它负责串起仓库选择、Issue 浏览、任务排队、Agent 执行、Review 回路，以及最终的分支提交或 Pull Request 创建。

这个项目的目标不是做一个通用聊天界面，而是把“接 Issue -> 改代码 -> 审查 -> 提交结果”这条链路收敛成一个可重复运行的工程流程。

![BuildBot Dock Icon](assets/buildbot-dock.png)

## 为什么做这个项目

面向 GitHub Issue 的自动化开发工具很多，但常见问题也很明显：

- 只能调用单一模型，难以区分“执行”和“审查”角色
- 缺少任务队列与可视化日志，不适合连续处理多个 Issue
- 能改代码，但缺少稳定的 Review 回路，结果难直接合入
- 自动拉取 Issue 后容易失控，缺少人工确认和风险拦截

BuildBot Desktop 的思路是把这些能力放进一个本地应用里，让仓库维护者可以更直接地控制 Agent 行为、提交流程和自动化边界。

## 核心特性

- GitHub 登录与仓库 / Issue 浏览，支持筛选、查看详情和评论
- 一键把 Issue 发起为 `bugfix` 或 `feature` 任务
- 串行任务队列，适合持续处理多个待办项
- Implementation Agent 与 Review Agent 分离，且可分别选择 Claude 或 Codex
- Review 严格度可配置，支持多轮审查与返工
- Review 通过后自动提交结果，支持创建 PR 或直推目标分支
- 自动模式可定时轮询 Open Issues，并按标签白名单自动入队
- 实时日志面板，便于追踪执行过程、失败点和审查反馈
- 风险 Issue 检测，命中高风险规则时自动转人工确认
- GitHub Token 存入系统 Keychain，而不是明文落盘

## 工作流

1. 使用 GitHub PAT 登录并拉取可访问仓库。
2. 选择仓库和目标 Issue，发起 `AI 修复` 或 `AI 开发`。
3. BuildBot 准备工作区。
   `PR 模式`：自动执行 Fork -> 分支 -> Clone。  
   `直提模式`：直接切到配置的目标分支。
4. Implementation Agent 在本地工作区修改代码，并输出过程日志。
5. Review Agent 以只读方式审查当前改动，判断 `PASS` 或 `FAIL`。
6. 如果审查失败，系统按反馈继续返工，直到通过或达到最大轮次。
7. 审查通过后，自动提交结果。
   `PR 模式`：push 并创建 Pull Request。  
   `直提模式`：push 到指定分支。

## 前置条件

在本地运行前，需要准备：

- 一个可用的 Node.js / npm 环境
- 本机已安装 `git`
- 一个 GitHub Personal Access Token
  建议至少具备 `repo`、`workflow` 权限
- 至少安装并登录一个 Agent CLI
  `claude`：执行 `claude auth login`
  `codex`：执行 `codex login`

如果你希望把 Claude 用作执行或审查器，还需要本机安装 Claude Code。  
如果你希望把 Codex 用作执行或审查器，还需要本机安装 Codex CLI。

## 快速启动

```bash
npm install
npm run dev
```

常用检查命令：

```bash
npm test
npm run typecheck
```

## 使用方式

1. 启动应用后输入 GitHub PAT 登录。
2. 选择仓库，浏览或筛选 Issue。
3. 打开目标 Issue，点击 `AI 修复` 或 `AI 开发`。
4. 在右侧日志区域查看执行过程。
5. 在设置面板中调整：
   Implementation Provider
   Review Provider
   Review Strictness
   Review Max Rounds
   Submission Mode
   Direct Branch Name

## 自动模式

自动模式用于持续轮询当前仓库的 Open Issues，并自动把符合条件的任务放进队列。

- 轮询范围：当前选中仓库的 Open Issues
- 触发时机：登录后、切换仓库后，以及后续定时轮询
- 入队规则：只处理命中标签白名单的 Issue
- 默认白名单：`bug`, `enhancement`
- 自动去重：已有任务的 Issue 不会重复入队
- 风险拦截：带有人工确认标签或命中高风险规则的 Issue 会被跳过

这使它更适合处理一类“可以批量自动推进，但仍需要边界控制”的仓库维护任务。

## 安全与控制

BuildBot Desktop 不是无条件执行器，当前版本已经加入了一些基础保护：

- 检测疑似 prompt injection、凭据导出、破坏性命令、远程脚本执行等高风险内容
- 命中规则后自动添加 `needs-human-confirmation` 标签并暂停执行
- Review Agent 只做审查，不允许修改文件或直接提交
- GitHub Token 使用系统 Keychain 保存

这套机制仍然是 MVP 级别，但已经覆盖了最常见的自动化失控场景。

## 当前限制

- 仍以 PAT 登录为主，尚未接入完整 GitHub OAuth 流程
- Prompt 自定义、多账号切换、通知系统仍未实现
- Markdown 渲染暂未加入 DOM sanitizer
- 依赖本机已有 `git` 与至少一个可用的 Agent CLI
- Electron 打包配置已存在，但仓库里还没有整理完整发布流程

## 技术栈

- Electron
- React
- TypeScript
- Vite
- Zustand
- Octokit
- simple-git
- keytar

## 项目结构

```text
src/
  main/
    agent/          # Agent 调度
    automation/     # 自动模式
    claude/         # Claude CLI 集成
    codex/          # Codex CLI 集成
    git/            # Git 工作区与提交流程
    github/         # GitHub API 与 Token 管理
    ipc/            # Electron IPC
    queue/          # 任务队列与执行主流程
    security/       # Issue 风险检测
    settings/       # 本地配置
    task-history/   # 任务持久化
  renderer/
    components/
    store/
  shared/
tests/
assets/
```

## 适合谁用

- 想把 GitHub Issue 处理流程自动化的个人开发者
- 需要一个本地可控的 AI coding 工作台，而不是纯云端代理
- 希望把“实现”和“审查”拆给不同 Agent 的仓库维护者
- 想先用 MVP 验证自动化研发流程，再决定是否扩展到更完整的平台
