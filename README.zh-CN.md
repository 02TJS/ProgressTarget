# ProgressTarget

[English](README.md) · **简体中文**

为 AI Agent 的长期任务提供持久化计划、可测量的质量门和可查看的进度。每个对话维护自己的计划，先制定，再经明确授权执行。

本仓库包含两个可以独立安装的插件：

| 平台 | 版本 | 进度界面 | 安装与使用 |
|---|---|---|---|
| DeepSeek Harness（DSH） | 2.0.1 | DSH Web 内的进度标签页 | [DSH 插件](dsh/README.zh-CN.md) |
| Codex | 0.1.0 | 当前任务专属的本地网页看板 | [Codex 插件](codex/README.zh-CN.md) |

两端都保留经过调研的质量指标、必要交付物、真实依赖阶段、北京时间 `+08:00` 截止时间、资源快照、重试与历史保护。遵循第一性原理和最小充分原则：额外报告、SHA、复现材料和消融只在任务确有需要时要求。

## 仓库结构

```text
ProgressTarget/
├── README.md           # 英文主页
├── README.zh-CN.md     # 中文主页
├── LICENSE
├── dsh/                # DSH 插件、文档与测试
└── codex/              # Codex 插件、看板、文档与测试
```

两端属于同一个项目，共享设计原则，分别维护宿主适配、版本、依赖和运行数据。安装其中一个，不会同时安装另一个。

## 安装 DSH 版

克隆仓库，把 **`dsh` 子目录** 加入承载 DSH Web 界面的实际 Profile：

```sh
git clone https://github.com/02TJS/ProgressTarget.git
cd ProgressTarget
dsh plugin --profile <你的-profile> add ./dsh
```

然后重启原有 DSH Web Host。仓库根目录不再是 DSH Profile Bundle。详细说明见 [DSH 指南](dsh/GUIDE.zh-CN.md)和[配置说明](dsh/CONFIGURATION.md)。

## 安装 Codex 版

需要 Node.js 22 或更新版本，以及支持 `codex plugin` 命令的 Codex CLI。在克隆的仓库中运行：

```sh
cd codex
npm ci
npm run build
codex plugin marketplace add .
codex plugin add progress-target@progress-target
```

Windows 下也可直接双击 `codex/安装插件.cmd`：缺少运行包时会先构建，再安装本地插件。安装后在新的 Codex 任务中加载工具和技能。

插件市场放在 `codex/.agents/`，注册市场时应进入 `codex/`，不要把整个仓库根目录当作 Codex 市场。路径配置由安装脚本按实际位置生成；移动目录后重新运行安装入口。

## 制定、执行与查看计划

在 Codex 中说：

```text
请使用已安装的 progress-target:progress-target 技能，为【任务】制定当前对话自己的计划。
先阅读技能的 SKILL.md，再按其中的相对链接完整阅读 GUIDE.md。
实际调用插件保存计划，全部阶段保持 pending，整体 executionState 保持 paused，暂不执行。
完成后返回本对话的看板链接。
```

确认计划后说“按当前 ProgressTarget 计划开始执行”，查看时说“打开当前对话的 ProgressTarget 看板”。制定与执行在同一对话完成；新对话和分叉对话有独立的空计划范围。完整提示词分别见 [Codex 使用流程](codex/docs/usage.md)和 [DSH 提示词](dsh/PROMPT.zh-CN.md)。

Codex 看板是本地只读网页。可选的 SessionStart、Stop、Interrupt Hook 需要宿主信任，安装本身不代表自动生效；信任后的真实宿主事件仍需验证。两个版本都不提供独立实验执行器或后台调度器。具体差异见[功能对照与限制](codex/docs/feature-audit.md)。

## 开发与维护

DSH 在 `dsh/` 执行 `npm test`；Codex 在 `codex/` 执行 `npm ci`、`npm run build`、`npm test`。各自目录包含开发、配置和打包说明。运行计划、本机路径配置、依赖和本地验证输出不提交到 Git，也不放入公开分发包。

MIT © 2026 02TJS，见 [LICENSE](LICENSE)。Codex 打包依赖的许可见[第三方声明](codex/plugins/progress-target/THIRD-PARTY-NOTICES.md)。
