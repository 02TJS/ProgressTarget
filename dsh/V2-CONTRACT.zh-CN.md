# v2 质量贡献契约

Progress Target 对旧计划保持更新兼容：没有 `schemaVersion` 的既有计划仍可通过 `operation="update-phase"` 按原有 metrics、deliverables 和状态规则更新，但不会在读取或普通更新时自动改写为 v2。这里的兼容不表示 `init-plan` 会静默使用 v1。

新会话首次初始化计划时使用 `operation="init-plan"`，自动落盘为 `schemaVersion: 2`，并必须提供：

- `finalObjective`：最终目标、结构化最终指标、最终交付物；
- 每阶段 `metricResearch`：问题、来源、候选指标、选择结果和理由；
- 每阶段 `objectiveContribution`：关联最终指标、影响机制、证据等级、不确定性、风险与验证方案；
- 每个阶段指标的 `kind`、测量方法、局限性和阈值依据。

无法可靠预估前置阶段对最终效果的具体贡献时，`impactEstimate` 应为 `null`，并明确不确定性及满足最终目标所需的最小验证方案，禁止编造贡献数值，也不默认要求 pilot、消融或复现材料。

阶段目标必须能够区分质量好坏，不能只证明对象存在。`数量 > 0`、`文件数 > 0`、`结果数 > 0` 等目标只能作为 `process` 指标，不能充当质量门；如果一个阶段的全部质量指标都只是 `> 0` 或 `>= 0`，插件会拒绝该阶段。使用 `adaptive` 阈值时，应先通过充分调研或必要测量取得依据，随后将阈值冻结为具有正式依据的其他类型，再进入生产执行阶段；不默认要求额外 pilot。

## 示例

```json
{
  "operation": "init-plan",
  "introduction": "先调研并冻结数据质量代理指标，再执行训练与评估",
  "finalObjective": {
    "description": "得到满足测试效果与部署要求的模型",
    "metrics": [{"key":"NDCG@10","operator":">=","targetValue":0.25,"unit":""}],
    "deliverables": [{"name":"production-model","acceptance":"权重可加载且满足最终部署验收"}]
  },
  "phases": [{
    "id": "data-quality",
    "actionTitle": "调研并验证数据质量",
    "timeline": "预计20分钟",
    "what": "调研数据风险，比较候选代理指标并运行测量",
    "purpose": "控制会限制最终NDCG的标签噪声和覆盖风险",
    "deadlineAt": "2026-08-27T12:00:00+08:00",
    "status": "pending",
    "metricResearch": {
      "questions": ["哪些数据问题会限制最终排序效果？"],
      "sources": [{"title":"数据审计报告","location":"docs/data-audit.md","finding":"标签冲突和长尾缺失是主要风险"}],
      "candidateMetrics": [{"key":"标签冲突率","rationale":"衡量监督信号矛盾","measurement":"冲突标签数/复核标签总数","limitations":"不能识别一致但系统性错误的标签"}],
      "selectedMetrics": ["标签冲突率"],
      "selectionReason": "可在训练前测量且覆盖已识别的主要风险"
    },
    "objectiveContribution": {
      "finalObjectiveKeys": ["NDCG@10"],
      "mechanism": "标签冲突会降低监督信号质量并限制排序效果",
      "evidenceLevel": "literature-supported",
      "impactEstimate": null,
      "uncertainty": "当前数据集缺乏贡献幅度估计",
      "validationPlan": "在训练评估中按标签冲突分层比较NDCG，复用既定评估产物验证影响",
      "riskIfMissed": "训练可能在噪声监督下收敛到较差排序结果"
    },
    "metrics": [{
      "key":"标签冲突率","value":0.02,"operator":"<=","targetValue":0.01,"unit":"",
      "kind":"quality","measurement":"冲突标签数/复核标签总数","limitations":"不能识别系统性一致偏差",
      "thresholdBasis":{"type":"requirement","evidence":"数据验收要求：复核样本标签冲突率不高于1%","reason":"该上限直接约束训练输入质量"}
    }],
    "deliverables": [{"name":"clean-data","required":true,"acceptance":"数据可加载且关键质量指标达标","status":"pending","evidence":""}],
    "executionPlan": {"estimatedMinutes":20,"parallelizable":false,"shardable":false,"shardReason":"小规模审计需统一抽样","serialReason":"需在统一样本上顺序复核","resourceDiscovery":{"queriedAt":"2026-08-27T10:00:00+08:00","servers":[]},"resources":[{"id":"audit","work":"数据审计","resource":"CPU","expectedDeliverable":"质量报告","status":"planned"}]}
  }]
}
```

Tool 实际读取 `phases`，初始化不需要 `phase_id`，且只创建 `pending` 阶段。初始化时不要传顶层 `timeline` 字符串，因为实现不会保存该文本；每个 `phases[].timeline` 是对应单阶段的人类可读时间字符串。后续 `operation="update-phase"` 的顶层 `timeline` 同样只表示正在更新的单阶段时间字符串。

HTTP 兼容规则与 Tool 新格式分开：HTTP API 仍接受旧客户端使用顶层 `timeline` 对象数组，但持久化文件始终写为 `schemaVersion: 2`，阶段位于落盘 `timeline` 对象数组中。

`init-plan` 只允许创建不存在的计划。只要会话已有任何计划文件，包括历史空 `timeline` 文件，就明确失败并保持文件原样；不拼接终态阶段，也不静默回落到 v1。成功返回后必须重新读取并核对 `schemaVersion`、阶段数量和顺序 ID，不能只凭成功卡片判断完成。

## 显式迁移

旧计划不会自动迁移，仍使用 `operation="update-phase"` 更新。用户明确授权后，可调用 `operation="migrate-plan"`，同时提供 `userAuthorizedMigration=true`、非空 `migrationReason`、完整 `finalObjective`，以及 `phases`。迁移输入的阶段数量、原顺序和 ID 必须与既有计划完全一致。

迁移仅允许为每个旧阶段补充 `metricResearch`、`objectiveContribution` 和原 metrics 的 v2 元数据（`kind`、`measurement`、`limitations`、`thresholdBasis`）。原 metrics 的 `key`、`value`、`operator`、`targetValue` 和 `unit` 必须保持不变；其他字段、状态、结果及所有时间也不得改变。插件完整验证后才一次性写入；任何不一致都会使整次迁移失败并保留原文件。

迁移后必须重新读取计划，复查 `schemaVersion === 2`、阶段数量、顺序 ID 以及原指标数值；Tool 成功卡片不是完成证据。若用户希望放弃旧计划并重新初始化，必须先明确授权 `operation="delete-plan"`，提供 `userAuthorizedDeletion=true` 和非空 `deletionReason`，不得推定删除授权。

`thresholdBasis.type` 允许：`requirement`、`literature`、`historical-baseline`、`pilot-baseline`、`expert-judgment`、`adaptive`。证据等级允许：`hypothesis`、`literature-supported`、`pilot-supported`、`validated`。
