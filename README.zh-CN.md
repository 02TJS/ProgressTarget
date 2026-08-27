# DSH BigPlan

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

> 让 AI Agent 真正完成长期任务，而不只是写一份待办清单。

DSH BigPlan 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的持久化计划与执行控制插件。它为每个会话提供语义阶段、质量门、交付物门、截止时间、可审计重试、多资源执行计划和动态资源发现。

## 为什么需要 BigPlan？

普通 Agent 计划经常出现这些问题：没有可用交付物就宣布阶段完成；指标定义模糊；截止时间被悄悄延后；阶段转换后继续使用过期的 GPU 状态；明明可以自主推进，却频繁停下来等待用户确认。

BigPlan 将普通计划升级为可执行契约：

- **会话级持久化**：每个会话维护独立计划。
- **语义化阶段**：按真实依赖拆分，而不是机械四等分。
- **质量与交付物双门控**：指标达标和产物可用分别判断。
- **截止时间语义**：`completed` 表示按时达标；`overdue` 表示逾期但交付物仍可使用。
- **证据优先**：必需交付物必须具备验收标准和证据。
- **动态资源发现**：阶段启动、转换和重规划时刷新全部已配置资源。
- **全可用服务器分片**：可分片的推理、评估和数据任务必须覆盖所有可用服务器。
- **可审计重试**：记录结果摘要、诊断结论和下一轮调整。
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
dsh plugin --profile <你的-profile> add <DSH-BigPlan-本地路径>
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

BigPlan **没有通用服务器清单**。服务器名称、资源查询方式、质量阈值、交付物规则、存储位置、截止时间、权限与资源限制，都必须由使用者根据自己的环境配置。

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

生产使用前，请完整阅读[配置与部署审计清单](CONFIGURATION.md)。BigPlan 只校验 Agent 提交的状态和证据；它不会自动提供 SSH、调度器、凭据、GPU、计时器或后台作业能力。

## 状态语义

| 状态 | 含义 |
|---|---|
| `pending` | 已规划但尚未启动 |
| `in-progress` | 正在执行，可包含重试和重新估时 |
| `completed` | 截止时间前通过质量门和交付物门 |
| `overdue` | 已超过截止时间，质量可未达标，但必需交付物可用 |

必需交付物缺失时，即使超时也不能启动下游阶段。默认保护终态历史；管理性修改或删除应要求用户明确授权，并留下审计记录。

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

## 文档

- [配置与部署审计清单](CONFIGURATION.md)
- [完整中文使用指南](GUIDE.zh-CN.md)
- [生产提示词模板](PROMPT.zh-CN.md)
- [变更记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

MIT，参见 [LICENSE](LICENSE)。
