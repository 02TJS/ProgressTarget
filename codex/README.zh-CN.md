# ProgressTarget for Codex

[English](README.md) · **简体中文** · [仓库主页](../README.zh-CN.md)

版本 **0.1.0**。通过 Skill、五个 MCP 工具、可选生命周期 Hook 和本地实时看板维护任务。每个 Codex 对话有自己的计划与历史，即使它们使用同一个项目目录或 MCP 进程。

## 安装

需要 Node.js 22 或更新版本，以及支持 `codex plugin` 的 Codex CLI。在本 `codex/` 目录运行：

```sh
npm ci
npm run build
codex plugin marketplace add .
codex plugin add progress-target@progress-target
```

Windows 用户也可双击 **安装插件.cmd**：它在缺少运行包时构建，生成本目录的路径配置，注册本地市场并安装插件。源码首次安装需要 npm；已构建的发布 ZIP 安装时只需要 Node.js 和 Codex。

安装后在新的 Codex 任务中加载工具和技能。移动整个目录后重新运行安装入口。市场名为 `progress-target`，与个人市场分开。

## 使用流程

先说“用 ProgressTarget 为【任务】制作当前对话的计划，暂不执行”。代理从已安装的 Skill 定位指南，保存暂停计划并返回当前对话的看板链接。明确说“按当前计划开始执行”之后才开始工作。完整提示词见[使用流程](docs/usage.md)。

五个工具是 `plan_create`、`plan_get`、`phase_update`、`plan_manage`、`plan_open`。每次调用都必须使用调用方真实的 `threadId`；目录、根 session 或共享 MCP 进程不能代替对话身份。

## 查看进度

说“打开当前对话的 ProgressTarget 看板”。`plan_open` 返回当前任务专属的本地网页链接，可用系统浏览器或客户端提供的网页面板查看。页面提供阶段、质量指标、交付物、截止时间、资源、重试、历史、JSON 导出和自动更新。

Windows 下，**启动看板.cmd** 启动服务，**停止看板.cmd** 停止服务。默认端口为 18765，占用时自动使用空闲端口，实际地址写入 `runtime/dashboard.json`。不带对话身份的地址显示入口说明，不会自动选择其他对话的计划。需要体验合成数据时，先运行 `npm run demo`，再进入页面的显式演示入口。

## 项目与数据

源码、生成配置、运行数据、日志和发布包集中在本目录。Codex 另行维护自身的安装记录和插件缓存。

| 路径 | 用途 |
|---|---|
| `plugins/progress-target/` | 插件清单、技能、MCP、Hook、规则核心和页面 |
| `.agents/plugins/marketplace.json` | 本地市场入口 |
| `runtime/data/plans/` | 持久化计划正文 |
| `runtime/data/threads/<threadId>/current.json` | 每个对话的当前计划指针 |
| `plugins/progress-target/local-config.json` | 自动生成的项目位置、端口和资源配置 |
| `tests/`、`scripts/`、`docs/` | 测试、管理脚本与文档 |
| `dist/` | 自动生成的发布 ZIP |

`requiredServers` 默认是空列表，只有部署确实要求固定资源清单时才配置。个人运行数据与自动生成的绝对路径不提交到 Git，也不放入公开 ZIP。移动项目不会改写历史证据中的原始路径。

## 能力与边界

保留经过调研的 v2 质量指标、阈值依据、必要交付物、依赖顺序、北京时间截止时间、历史保护、显式迁移、版本冲突校验和原子保存。计划默认暂停。旧 v1 计划可以导入后继续使用，不强制升级。详见[完整指南](plugins/progress-target/GUIDE.md)和[功能对照](docs/feature-audit.md)。

看板只读，资源记录和证据由执行代理提供。插件不自行运行 SSH/GPU 作业、验证外部测量、定时唤醒模型或绕过宿主限制。可选 SessionStart、Stop、Interrupt Hook 需要宿主信任；其代码有测试，信任后的真实宿主事件仍需单独验收，不能把安装完成理解成自动生效。

## 开发与打包

```sh
npm ci
npm run build
npm test
node scripts/verify-ui.mjs
npm run package
```

界面检查使用隔离目录中的合成计划，需要已安装 Chrome，也可设置 `PT_BROWSER_CHANNEL=msedge`。无需真实任务或正在运行的看板。打包需要 Python 3；已构建的运行包不需要 Python。Windows 发布包与启动入口检查见[开发说明](docs/development.md)。

MIT © 2026 02TJS，见 [LICENSE](LICENSE) 和[第三方声明](plugins/progress-target/THIRD-PARTY-NOTICES.md)。
