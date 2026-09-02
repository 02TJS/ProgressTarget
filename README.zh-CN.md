# DSH ProgressTarget

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

> 让 AI Agent 真正完成长期任务，而不只是写一份待办清单。

DSH ProgressTarget 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的持久化计划与执行控制插件。它为每个会话提供语义阶段、质量门、交付物门、截止时间、可审计重试、多资源执行计划和动态资源发现。

## 为什么需要 ProgressTarget？

普通 Agent 计划经常出现这些问题：没有可用交付物就宣布阶段完成；指标定义模糊；截止时间被悄悄延后；阶段转换后继续使用过期的 GPU 状态；明明可以自主推进，却频繁停下来等待用户确认。

ProgressTarget 将普通计划升级为可执行契约：

- **会话级持久化**：每个会话维护独立计划。
- **语义化阶段**：按真实依赖拆分，而不是机械四等分。
- **质量与交付物双门控**：指标达标和产物可用分别判断。
- **阶段质量关联最终目标**：v2 每阶段必须说明该阶段质量如何保护、提升或验证最终目标。
- **先调研、后选指标**：比较候选代理指标，记录可追溯来源、测量方法、局限性和阈值依据。
- **诚实表达不确定性**：无法预估贡献幅度时保留 `null`，通过 pilot、消融或对照实验验证，禁止编造精确收益。
- **北京时间统一**：所有时间以明确的 `+08:00` 偏移存储，并强制按 Asia/Shanghai 显示，不受 Host 或浏览器本地时区影响。
- **截止时间语义**：`completed` 表示按时达标；`overdue` 表示逾期但交付物仍可使用。
- **证据优先**：必需交付物必须具备验收标准和证据。
- **动态资源发现**：阶段启动、转换和重规划时刷新全部已配置资源。
- **全可用服务器分片**：可分片的推理、评估和数据任务必须覆盖所有可用服务器。
- **可审计重试**：记录结果摘要、诊断结论和下一轮调整。
- **不设 continuation 轮数上限**：未超过截止时间且仍有可执行调整方案时，必须继续调研和重试；尝试次数或自动续跑预算不能成为停止理由。
- **递归重新估时**：未完成时重新安排 50%/100% 检查点，而不是高频轮询。
- **进度可视化**：在 DSH Web 中查看阶段、指标、交付物、重试、截止时间和资源快照。

## 执行模型

```text
制定计划 → 发现资源 → 启动阶段
  ↓
5分钟 / 50% / 75% 检查 → 100%结果收获
  ↓
质量门 + 交付物门 + 截止时间门
  ├─ 按时全部通过 → completed → 刷新资源 → 下一阶段
  ├─ 质量未达标、交付物可用且已超时 → overdue → 刷新资源 → 下一阶段
  └─ 交付物缺失 → 保持 in-progress → 诊断 → 重规划 → 重试
```

## 安装

本仓库是一个 DSH Profile Bundle。请将它加入承载 Web GUI 的实际 Profile；Profile 名称由部署决定：

```powershell
dsh plugin --profile <你的-profile> add <ProgressTarget-本地路径>
```

安装后重启原有 DSH Web Host。不要另起一个替代 Vite 服务，因为 Web 启动状态由正在运行的 DSH Host 注入。

开发时，可以将仓库复制或链接到用户自有的 DSH 插件目录，再加入相应 Profile，并按当前 DSH 版本要求重新构建或重启受影响的 Web 产物。

## 快速开始

安装后，让 Agent 先阅读 [`GUIDE.zh-CN.md`](GUIDE.zh-CN.md)，然后在执行任务时调用 `update-progress-target`：

```text
请执行 [XXX任务]。开始前先完整阅读本仓库的 GUIDE.zh-CN.md，并使用 update-progress-target 为当前会话建立独立计划。按真实依赖拆分语义阶段；每阶段必须设置 deadlineAt、结构化质量硬目标、可供下一阶段消费的必需交付物及验收证据、executionPlan 和资源分支。建立计划、启动阶段、阶段转换和重规划时，都要重新查询全部配置资源的实时状态，不能复用旧快照。除非缺少用户专属输入、权限、安全确认或遇到无法自主解决的外部阻塞，否则持续推进到完整计划结束。
```

完整提示词位于 [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md)。

## 使用前配置自己的部署

ProgressTarget **没有通用服务器清单**。服务器名称、资源查询方式、质量阈值、交付物规则、存储位置、截止时间、权限与资源限制，都必须由使用者根据自己的环境配置。

在 `cordis.patch.yml` 中修改：

```yaml
config:
  requiredServers:
    - gpu-a
    - gpu-b
  resourceDiscoveryMaxAgeMinutes: 10
  dataDir: .progress-target
```

| 配置 | 默认值 | 含义 |
|---|---:|---|
| `requiredServers` | `[]` | 每份资源快照必须覆盖的固定服务器或资源池清单 |
| `resourceDiscoveryMaxAgeMinutes` | `10` | 阶段启动或重规划时允许的最大快照年龄 |
| `dataDir` | `.progress-target` | 相对于 `DSH_CWD` 或 Host 工作目录的存储目录 |

`requiredServers: []` 表示不强制固定服务器清单，适用于 CPU-only、云端自动扩缩容、调度器资源池或动态发现环境。如果配置了清单，每份快照必须覆盖所有名称；同时仍允许记录额外发现的资源。

生产使用前，请完整阅读[配置与部署审计清单](CONFIGURATION.md)。ProgressTarget 只校验 Agent 提交的状态和证据；它不会自动提供 SSH、调度器、凭据、GPU、计时器或后台作业能力。

## 状态语义

| 状态 | 含义 |
|---|---|
| `pending` | 已规划但尚未启动 |
| `in-progress` | 正在执行，可包含重试和重新估时 |
| `completed` | 截止时间前通过质量门和交付物门 |
| `overdue` | 已超过截止时间，质量可未达标，但必需交付物可用 |

必需交付物缺失时，即使超时也不能启动下游阶段。默认保护全部历史；用户明确授权后，可用 `delete-phase` 删除任意状态阶段，或用 `delete-plan` 永久删除当前会话整份计划。删除必须提供 `userAuthorizedDeletion=true` 和非空理由，不得自行推定授权。阶段删除会写入 `deletionAudit`。

## 存储

计划按会话保存到：

```text
<DSH_CWD>/<dataDir>/<sessionId>.json
```

默认 `dataDir` 为 `.progress-target`。不要提交运行态计划文件；仓库的 `.gitignore` 已排除默认目录。

## 安全与隐私

- 发布截图或计划 JSON 前，先检查资源查询证据。
- 不要在 evidence 字段写入 Token、密码、私钥、内部用户名或机密数据路径。
- 集群凭据应由部署自身的秘密管理系统维护。
- 使用前明确计划文件的保留、备份以及授权修改策略。

## v2 质量贡献契约

新计划使用 `schemaVersion: 2`，首先定义结构化 `finalObjective`，包括最终指标和最终交付物。每个阶段随后必须提供：

- `metricResearch`：调研问题、可追溯来源、候选指标、已选指标及选择理由；
- `objectiveContribution`：关联的最终指标、影响机制、证据等级、不确定性、未达标风险和验证方案；
- 指标元数据：`kind`、测量方法、局限性和阈值依据。

v2 阶段不能只用“任务完成”“文件生成”等过程指标通过门控，至少需要一个经过调研的 `quality` 或 `final` 指标，用于保护、提升或验证最终目标。插件会拒绝 `数量 > 0`、`文件数 > 0` 等只证明“存在”的空洞阈值，也会拒绝全部质量指标都只是 `> 0` 或 `>= 0` 的阶段。`adaptive` 阈值仅用于探索，必须在调研或 pilot 后冻结为具有证据依据的正式阈值，才能进入正式阶段。若暂时无法估算影响幅度，应将 `impactEstimate` 设为 `null`，明确不确定性，并安排 pilot、消融或对照验证，不能编造数值。

## 兼容与迁移

既有且没有 `schemaVersion` 的计划继续按 v1 规则执行，不会被静默改写；仍可更新进度、结束阶段并按原契约推进。

迁移必须显式、完整且原子化。调用 `operation="migrate-plan"` 时，必须设置 `userAuthorizedMigration=true`、填写迁移原因，并为全部既有阶段提供完整 v2 契约。迁移不得增删阶段，也不得改写原状态和完成时间；任何验证失败都会保留磁盘中的原 v1 计划。详见 [v2质量贡献契约和迁移示例](V2-CONTRACT.zh-CN.md)。

## 文档

- [v2质量贡献契约](V2-CONTRACT.zh-CN.md)
- [配置与部署审计清单](CONFIGURATION.md)
- [完整中文使用指南](GUIDE.zh-CN.md)
- [生产提示词模板](PROMPT.zh-CN.md)
- [变更记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

MIT，参见 [LICENSE](LICENSE)。
