# v2 契约示例

先完整阅读 [GUIDE](../../../GUIDE.md)。这是形状示例，不是实际研究结果。threadId 必须在当前对话读取 CODEX_THREAD_ID 后替换，绝不能复制占位符或另一个对话的 ID。替换工作区、北京时间 +08:00 的截止时间、实际目标、来源与阈值依据。仅制定计划时保持 paused/pending；未知实测值使用 null；资源发现使用 deferred，获准执行前再进行真实查询。

新计划的每个阶段都要有 metricResearch、objectiveContribution、metrics、必需 deliverables 和 executionPlan。按最小充分原则填写，不预先占用资源。

关键参数：创建使用 timeline 数组；更新使用 phaseId 与 patch，不需要重传全部计划。每个阶段只纳入决策或验收所需项目。

```json
{
  "title": "契约回归测试",
  "introduction": "仅用于隔离验证的计划",
  "workspaceRoot": "C:/work/my-project",
  "threadId": "REPLACE-WITH-CURRENT-CODEX-THREAD-ID",
  "executionState": "paused",
  "finalObjective": {
    "description": "交付可使用的成果",
    "metrics": [
      {
        "key": "最终验收通过率",
        "operator": ">=",
        "targetValue": 100,
        "unit": "%"
      }
    ],
    "deliverables": [
      {
        "name": "最终成果",
        "acceptance": "通过所有约定的最终验收项"
      }
    ]
  },
  "timeline": [
    {
      "id": "phase-1",
      "actionTitle": "验证 phase-1",
      "what": "完成约定的阶段工作与验收",
      "purpose": "验证最终交付物可用性",
      "status": "pending",
      "deadlineAt": "2026-09-05T14:06:55.617+08:00",
      "metrics": [
        {
          "key": "验收通过率",
          "value": null,
          "operator": ">=",
          "targetValue": 100,
          "unit": "%",
          "kind": "quality",
          "measurement": "按约定验收清单逐项验证，通过项/必需项",
          "limitations": "仅覆盖已经约定的验收场景",
          "thresholdBasis": {
            "type": "requirement",
            "evidence": "任务验收清单",
            "reason": "约定的必需验收项应全部通过"
          }
        }
      ],
      "deliverables": [
        {
          "name": "交付物-phase-1",
          "required": true,
          "acceptance": "可以被下一阶段读取和使用",
          "status": "pending",
          "evidence": ""
        }
      ],
      "metricResearch": {
        "questions": [
          "如何直接验证交付物可用性？"
        ],
        "sources": [
          {
            "title": "任务验收要求",
            "location": "fixture://acceptance",
            "finding": "使用实际消费场景检查可用性"
          }
        ],
        "candidateMetrics": [
          {
            "key": "验收通过率",
            "rationale": "直接覆盖约定的消费场景",
            "measurement": "通过项/必需项",
            "limitations": "覆盖范围由验收清单确定"
          }
        ],
        "selectedMetrics": [
          "验收通过率"
        ],
        "selectionReason": "直接衡量交付物是否满足任务的消费要求"
      },
      "objectiveContribution": {
        "finalObjectiveKeys": [
          "最终验收通过率"
        ],
        "mechanism": "逐阶段验证下游需要的输入及最终使用场景",
        "evidenceLevel": "hypothesis",
        "impactEstimate": null,
        "uncertainty": "无法预估对未覆盖场景的影响",
        "validationPlan": "用最终交付物执行约定的端到端验收",
        "riskIfMissed": "下游得到不可用输入"
      },
      "executionPlan": {
        "estimatedMinutes": 20,
        "parallelizable": false,
        "shardable": false,
        "serialReason": "阶段按约定顺序验证",
        "resourceDiscovery": {
          "deferred": true,
          "reason": "仅制定计划；执行前重新查询真实资源",
          "servers": []
        },
        "resources": [
          {
            "id": "local",
            "work": "完成阶段验收",
            "resource": "CPU",
            "expectedDeliverable": "可验收交付物",
            "status": "planned"
          }
        ]
      }
    }
  ]
}
```

资源快照必须在有效时间窗口内。启动下游时，查询时间必须晚于上一阶段结束时间；重规划时必须晚于上一份快照。超过30分钟且可并行的阶段至少安排两个真实分支；可分片且多台 GPU 服务器可用时覆盖这些服务器。插件仅校验记录，不会代替 SSH 或调度器执行查询。
