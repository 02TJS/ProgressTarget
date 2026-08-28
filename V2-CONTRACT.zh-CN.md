# v2 质量贡献契约

Progress Target 对旧计划保持兼容：没有 `schemaVersion` 的既有计划视为 v1，仍可按原有 metrics、deliverables 和状态规则更新，不会在读取时自动改写。

新会话首次初始化计划时自动使用 `schemaVersion: 2`，必须提供：

- `finalObjective`：最终目标、结构化最终指标、最终交付物；
- 每阶段 `metricResearch`：问题、来源、候选指标、选择结果和理由；
- 每阶段 `objectiveContribution`：关联最终指标、影响机制、证据等级、不确定性、风险与验证方案；
- 每个阶段指标的 `kind`、测量方法、局限性和阈值依据。

无法可靠预估前置阶段对最终效果的具体贡献时，`impactEstimate` 应为 `null`，并明确不确定性及后续 pilot、消融或对照验证方案，禁止编造贡献数值。

## 示例

```json
{
  "_initPlan": true,
  "introduction": "先调研并冻结数据质量代理指标，再执行训练与评估",
  "finalObjective": {
    "description": "得到可复现且测试效果达标的模型",
    "metrics": [{"key":"NDCG@10","operator":">=","targetValue":0.25,"unit":""}],
    "deliverables": [{"name":"production-model","acceptance":"权重可加载且附测试报告和SHA"}]
  },
  "timeline": [{
    "id": "data-quality",
    "actionTitle": "调研并验证数据质量",
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
      "validationPlan": "通过pilot和后续噪声消融验证",
      "riskIfMissed": "训练可能在噪声监督下收敛到较差排序结果"
    },
    "metrics": [{
      "key":"标签冲突率","value":0.02,"operator":"<=","targetValue":0.01,"unit":"",
      "kind":"quality","measurement":"冲突标签数/复核标签总数","limitations":"不能识别系统性一致偏差",
      "thresholdBasis":{"type":"pilot-baseline","evidence":"artifacts/pilot-audit.json","reason":"人工复核确定1%为当前可接受上限"}
    }],
    "deliverables": [{"name":"clean-data","required":true,"acceptance":"数据可加载并附质量报告和SHA","status":"pending","evidence":""}],
    "executionPlan": {"estimatedMinutes":20,"parallelizable":false,"shardable":false,"shardReason":"小规模审计需统一抽样","serialReason":"","resourceDiscovery":{"queriedAt":"2026-08-27T02:00:00Z","servers":[]},"resources":[{"id":"audit","work":"数据审计","resource":"CPU","expectedDeliverable":"质量报告","status":"planned"}]}
  }]
}
```

## 显式迁移

旧计划不会自动迁移。用户明确授权后，可调用 `operation="migrate-plan"`，同时提供 `userAuthorizedMigration=true`、迁移原因、完整 `finalObjective`，以及与既有阶段数量和ID完全一致的v2阶段契约。插件在内存中完整验证所有阶段后才一次性写入；任何字段不合格都会使整次迁移失败，磁盘上的v1计划保持不变。迁移不得借机增删阶段或改写既有状态和完成时间。

`thresholdBasis.type` 允许：`requirement`、`literature`、`historical-baseline`、`pilot-baseline`、`expert-judgment`、`adaptive`。证据等级允许：`hypothesis`、`literature-supported`、`pilot-supported`、`validated`。
