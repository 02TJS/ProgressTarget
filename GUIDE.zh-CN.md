# dsh-progress-target 插件使用说明

## 1. 用途

`dsh-progress-target` 为每个会话保存独立的多阶段实验计划。阶段数不固定，Agent 必须按真实依赖拆分语义阶段，例如：

```text
contract-freeze → data-prep → train-baseline → tune → ablation → full-eval → stat-test → report
```

数据按会话存储：

```text
<workspace>/.progress-target/<sessionId>.json
```

## 2. 强制机制

### 2.0 第一性原理与最小充分原则

如无必要，不增实体。每个阶段、指标、交付物、证据、资源分支或审计步骤必须至少满足一项：改变执行决策；验证最终质量或实际可用性；保护真实安全边界；满足下一阶段或用户明确提出的交付要求。不能满足时不得加入计划。已有充分证据时直接推进，不得反复审计计划是否合理。SHA、复现说明、manifest、额外报告、消融实验都不是默认要求；只有用户明确要求，或防篡改、跨环境交付、科学复现等确属最终目标必要条件时才加入。指标调研在足以选出可测指标和有依据阈值后即停止，避免为了形式继续搜索和论证。

### 2.1 时间记录

所有计划时间统一采用北京时间（Asia/Shanghai，UTC+08:00）。传给插件的时间必须是带 `+08:00` 偏移的 ISO 8601 字符串，例如 `2026-08-26T10:30:00+08:00`；无时区时间、`Z`（UTC）或其他偏移会被拒绝。插件自动生成的时间同样以 `+08:00` 保存，Web UI 强制按北京时间显示，不依赖浏览器本地时区。

每个阶段具有以下结构化时间：

| 字段 | 规则 |
|---|---|
| `createdAt` | 阶段首次创建时由插件自动记录 |
| `startedAt` | 首次进入 `in-progress` 时自动记录，也可显式传入 ISO 8601 时间 |
| `deadlineAt` | 规划或启动阶段时必须设置；必须晚于 `startedAt` |
| `completedAt` | 达标完成或逾期结束时自动记录 |

`timeline` 仅作为人类可读说明，不能替代上述结构化时间。

### 2.2 硬目标门控

每个阶段在规划时必须设置至少一个结构化硬目标：

```json
{
  "key": "HR@10",
  "value": 0.352,
  "operator": ">=",
  "targetValue": 0.40,
  "unit": ""
}
```

允许的比较运算符：`>=`、`>`、`<=`、`<`、`==`。

只有全部硬目标达标，并且尚未超过 `deadlineAt`，阶段才允许进入 `completed`。

### 2.3 最小交付物门控

完成计划是根本目标。每阶段必须规划至少一个可供下一阶段消费的交付物：

```json
{
  "name": "baseline-checkpoint",
  "required": true,
  "acceptance": "模型权重可加载，附任务所需的最小验证证据",
  "status": "pending",
  "evidence": ""
}
```

交付物只有在 `status="ready"` 且 `evidence` 非空时才算齐备。交付物可以质量不达标，但不能不存在、无法加载或没有证据。

双门控规则：

- **质量门通过 + 交付物门通过 + 未超时**：允许 `completed`；
- **质量门未通过 + 交付物门通过 + 已超时**：允许 `overdue`，不算达标，但可以推进计划；
- **交付物门未通过**：无论是否超时，都必须继续 `in-progress`，不得结束，也不得启动下一阶段。

超时但交付物缺失时，插件标记 `deadlineBreached=true`。Agent 必须立即总结缺口、重新估计剩余时间、更新新的 `deadlineAt`，继续产出最小可用交付物。

### 2.4 并行资源与加速门控

每个阶段必须填写 `executionPlan`，明确预计耗时、是否可并行以及资源分支：

```json
{
  "estimatedMinutes": 60,
  "parallelizable": true,
  "shardable": true,
  "shardReason": "",
  "serialReason": "",
  "resourceDiscovery": {
    "queriedAt": "2026-08-26T09:00:00+08:00",
    "servers": [
      {"name":"gpu-a","status":"available","availableGpus":5,"evidence":"ssh gpu-a nvidia-smi"},
      {"name":"gpu-b","status":"available","availableGpus":8,"evidence":"ssh gpu-b nvidia-smi"},
      {"name":"inference-pool","status":"busy","availableGpus":0,"evidence":"scheduler query inference-pool"},
      {"name":"workstation-1","status":"available","availableGpus":1,"evidence":"ssh workstation-1 nvidia-smi"}
    ]
  },
  "resources": [
    {
      "id": "gpu-train",
      "work": "训练主模型",
      "resource": "GPU-0",
      "server": "gpu-a",
      "shard": "users-0-9999",
      "expectedDeliverable": "模型checkpoint和训练日志",
      "status": "running"
    },
    {
      "id": "cpu-eval",
      "work": "准备验证集并运行基线评估",
      "resource": "CPU后台作业",
      "expectedDeliverable": "验证集manifest和基线指标",
      "status": "running"
    }
  ]
}
```

规则：

- 每次阶段从 `pending` 进入 `in-progress`，以及进行中阶段提交新 `executionPlan` 重规划时，都必须重新查询插件 `requiredServers` 配置中的全部服务器，不能找到第一台GPU后停止查询；
- 快照仅在查询后配置的新鲜度窗口内有效；阶段切换时 `queriedAt` 必须晚于上一阶段 `completedAt`，同一阶段重规划时必须晚于上一份快照，因此不能复用旧状态；
- 每台服务器必须记录状态、可用GPU数、查询时间和命令/调度证据；插件将每次快照追加到 `resourceDiscoveryHistory`，保留 `generation`、触发原因、记录时间和服务器明细；
- 推理、评估、数据处理等可分片任务设置 `shardable=true`；若多台服务器可用，资源分支必须覆盖全部可用服务器并标明 `shard`；
- 不可分片时填写 `shardReason`；
- `estimatedMinutes > 30` 且可并行时，至少安排2个独立资源分支；
- 可使用 GPU、CPU、后台作业、子进程、subagent 或独立调研分支；
- 确实只能串行时设置 `parallelizable=false` 并填写 `serialReason`；
- 资源分支必须写明工作内容、所用资源、预期交付物和状态；
- 每次巡检检查空闲资源、慢分支、可新增并行任务和各分支交付物；
- 预计完成点仍未结束时，重估剩余时间并重新分析资源分配，同时提交新的 `executionPlan`。

插件自动生成初始检查点：5分钟、预计总时间50%、75%；预计总时间100%作为结果收获点，不属于普通巡检。

### 2.5 continuation 不设轮数上限

Progress Target 不使用固定 continuation 或重试轮数作为停止条件。阶段尚未超过 `deadlineAt`、质量目标未达标且 `attempt.adjustment` 仍可执行时，Agent 必须继续调研、调整和重跑。不得使用 `maxRounds`、`maxRetries`、`stopAfterAttempts`，也不得因尝试次数多、改进缓慢或自动续跑预算用完而停止。只有阶段合法完成/逾期推进，或缺少用户专属输入、权限、安全确认，或出现有具体证据且无法替代的外部阻塞时，才允许停止。

## 3. 未达标或缺交付物时的强制循环

硬目标未达标或必需交付物缺失时，阶段不能完成。Agent 必须：

1. 保持 `status="in-progress"`；
2. 填写本轮量化结果；
3. 提交 `attempt`，包含本轮总结、调研/诊断结论和下一轮调整；
4. 按调整方案重新尝试；
5. 循环直到全部硬目标达标；若超时，则至少继续到必需交付物齐备后，才可用 `overdue` 结束并推进下一阶段。

```json
{
  "summary": "第2轮 HR@10=0.372，距离目标0.40仍差0.028",
  "findings": "验证集显示长尾物品召回不足，嵌入维度64偏低",
  "adjustment": "嵌入维度提升至128，并将长尾样本权重提高到1.5"
}
```

超过 `deadlineAt` 只是进入“逾期执行中”，不自动结束。若交付物仍缺失，必须保持 `in-progress`、重估新截止时间并继续执行；只有必需交付物全部齐备后，才可标记 `overdue`，表示质量未达标但已有可供下一阶段使用的交付物。不能用 `completed` 掩盖未达标结果。

## 4. 工具调用

### 4.1 创建并启动阶段

```javascript
update-progress-target({
  phase_id: "train-baseline",
  pLabel: "P2",
  actionTitle: "训练推荐基线模型",
  timeline: "预计30分钟",
  what: "训练DCN基线并评估全量验证集",
  purpose: "建立可比较的全量基线",
  deadlineAt: "2026-08-26T10:30:00+08:00",
  status: "in-progress",
  progress: 5,
  executionPlan: {
    estimatedMinutes: 60,
    parallelizable: true,
    resources: [
      {id:"gpu-train", work:"训练主模型", resource:"GPU-0", expectedDeliverable:"checkpoint和训练日志", status:"running"},
      {id:"cpu-eval", work:"准备验证集和基线评估", resource:"CPU后台作业", expectedDeliverable:"manifest和基线指标", status:"running"}
    ]
  },
  metrics: [
    {"key":"HR@10","value":0.31,"operator":">=","targetValue":0.40},
    {"key":"NDCG@10","value":0.18,"operator":">=","targetValue":0.22}
  ],
  deliverables: [
    {name:"baseline-checkpoint", required:true, acceptance:"权重可加载并通过任务所需验证", status:"pending", evidence:""}
  ],
  attempt: {
    summary: "初始验证 HR@10=0.31、NDCG@10=0.18",
    findings: "基线尚未达标，主要误差来自长尾召回",
    adjustment: "继续训练并提高长尾样本权重"
  },
  result: "初始 HR@10=0.31、NDCG@10=0.18，均未达硬目标"
})
```

`createdAt` 和 `startedAt` 会自动记录。首次启动该阶段时，`resourceDiscovery.queriedAt` 必须是配置的新鲜度窗口内的新快照；如果有上一阶段，还必须晚于上一阶段的 `completedAt`。每次刷新均写入 `resourceDiscoveryHistory`。

### 4.2 未达标后调整重试

```javascript
update-progress-target({
  phase_id: "train-baseline",
  status: "in-progress",
  progress: 55,
  metrics: [
    {"key":"HR@10","value":0.372,"operator":">=","targetValue":0.40},
    {"key":"NDCG@10","value":0.211,"operator":">=","targetValue":0.22}
  ],
  attempt: {
    summary: "第2轮 HR@10=0.372、NDCG@10=0.211",
    findings: "嵌入维度不足，长尾召回仍偏低",
    adjustment: "嵌入维度64→128，长尾权重1.0→1.5"
  },
  result: "第2轮仍未达标，已确定下一轮调整参数"
})
```

### 4.3 达标完成

```javascript
update-progress-target({
  phase_id: "train-baseline",
  status: "completed",
  progress: 100,
  metrics: [
    {"key":"HR@10","value":0.405,"operator":">=","targetValue":0.40},
    {"key":"NDCG@10","value":0.226,"operator":">=","targetValue":0.22}
  ],
  deliverables: [
    {name:"baseline-checkpoint", required:true, acceptance:"权重可加载并通过任务所需验证", status:"ready", evidence:"artifacts/baseline/model.pt; load-test=pass"}
  ],
  result: "第3轮指标达标，checkpoint可加载且证据齐备"
})
```

### 4.4 逾期但交付物缺失：继续执行

```javascript
update-progress-target({
  phase_id: "train-baseline",
  status: "in-progress",
  deadlineAt: "2026-08-26T11:00:00+08:00",
  progress: 90,
  metrics: [
    {"key":"HR@10","value":0.392,"operator":">=","targetValue":0.40}
  ],
  deliverables: [
    {name:"baseline-checkpoint", required:true, acceptance:"权重可加载并通过任务所需验证", status:"pending", evidence:""}
  ],
  attempt: {
    summary: "原截止时间已过，HR@10=0.392且checkpoint尚未落盘",
    findings: "训练结束但模型保存与加载验证失败",
    adjustment: "修复保存路径并重跑加载验证；新预计剩余20分钟"
  },
  result: "逾期执行中；交付物缺失，不能结束或推进下一阶段"
})
```

### 4.5 逾期结束

只有当前时间已经超过 `deadlineAt`，且所有必需交付物 ready 并有 evidence 时才能调用：

```javascript
update-progress-target({
  phase_id: "train-baseline",
  status: "overdue",
  overdue: true,
  progress: 90,
  metrics: [
    {"key":"HR@10","value":0.392,"operator":">=","targetValue":0.40}
  ],
  deliverables: [
    {name:"baseline-checkpoint", required:true, acceptance:"权重可加载并通过任务所需验证", status:"ready", evidence:"artifacts/baseline/model.pt; load-test=pass"}
  ],
  result: "HR@10未达0.40，但checkpoint已交付且可加载；逾期结束，不算质量通过，可推进下一阶段"
})
```

## 5. 计划初始化

HTTP API 可一次初始化完整计划：

```http
POST /api/progress-target?sessionId=<sessionId>
Content-Type: application/json
```

```json
{
  "_initPlan": true,
  "introduction": "全量推荐实验；预计2小时；巡检点5min→60min→90min→120min",
  "timeline": [
    {
      "id": "data-prep",
      "pLabel": "P1",
      "actionTitle": "数据准备",
      "timeline": "预计20分钟",
      "what": "清洗并划分全量数据",
      "purpose": "获得满足训练消费要求的输入",
      "deadlineAt": "2026-08-26T09:20:00+08:00",
      "status": "pending",
      "progress": 0,
      "executionPlan": {
        "estimatedMinutes": 20,
        "parallelizable": true,
        "serialReason": "",
        "resources": [
          {"id":"cpu-clean","work":"清洗数据","resource":"CPU后台作业A","expectedDeliverable":"清洗数据集","status":"planned"},
          {"id":"cpu-schema","work":"校验任务所需schema和数据可用性","resource":"CPU后台作业B","expectedDeliverable":"dataset manifest","status":"planned"}
        ]
      },
      "metrics": [
        {"key":"数据覆盖率","value":0,"operator":">=","targetValue":100,"unit":"%"}
      ],
      "deliverables": [
        {"name":"dataset-manifest","required":true,"acceptance":"含任务需要的样本统计和字段schema","status":"pending","evidence":""}
      ],
      "result": "规划完成，数据覆盖率初始值=0%"
    }
  ]
}
```

初始化时每个阶段必须包含：

- 语义化 `id`；
- `actionTitle`、`what`、`purpose`；
- `deadlineAt`；
- `executionPlan`，包括预计耗时、并行判断与资源分支；
- 至少一个结构化质量硬目标 `metrics`；
- 至少一个必需交付物 `deliverables`，并写明验收条件。

## 6. 留存与状态规则

| 转换 | 是否允许 |
|---|---|
| `pending → in-progress` | 允许，但必须设置 `deadlineAt` |
| `in-progress → completed` | 仅质量目标全部达标、必需交付物齐备且未超时 |
| `in-progress → overdue` | 仅已超过 `deadlineAt` 且必需交付物齐备；质量可未达标；随后立即推进下一阶段，不等待用户审批 |
| 超时但交付物缺失 | 继续 `in-progress`，重估新 `deadlineAt`，不得启动下一阶段 |
| `completed/overdue → 其他状态` | 禁止，除非用户明确授权 |

已经结束的阶段不得被重新初始化、清空、覆盖或回退。再次初始化计划时，插件会忽略同 ID 的终态输入，并自动把缺失的 `completed`/`overdue` 阶段追加回计划，完整保留其原始记录。

### 6.1 用户授权删除

默认情况下所有阶段都受保护，尤其是 `completed` 和 `overdue`。但用户在当前请求中明确授权后，可以删除任意状态的阶段或整份计划：

```json
{"operation":"delete-phase","phase_id":"old-phase","userAuthorizedDeletion":true,"deletionReason":"用户要求清除旧阶段后重建计划"}
```

```json
{"operation":"delete-plan","userAuthorizedDeletion":true,"deletionReason":"用户要求清除当前会话全部旧计划"}
```

两个操作都必须同时提供 `userAuthorizedDeletion=true` 和非空 `deletionReason`，Agent 不得从历史对话或模糊表述推定授权。`delete-phase` 支持 pending、in-progress、completed、overdue，并在计划的 `deletionAudit` 中记录北京时间、阶段ID和理由。`delete-plan` 永久删除当前会话的计划文件，使UI恢复“未制定目标计划表”；由于整份文件已删除，其审计理由只存在于本次工具调用记录中。

### 6.2 用户授权的终态审计补录

旧终态阶段缺少新格式审计字段时，用户可以明确授权补录。调用时设置：

```json
{
  "phase_id": "old-phase",
  "userAuthorizedAudit": true,
  "auditSupplement": {
    "reason": "用户授权补充旧阶段审计字段",
    "startedAt": "2026-08-26T09:00:00+08:00",
    "deadlineAt": "2026-08-26T10:00:00+08:00",
    "executionPlan": {"estimatedMinutes":60,"parallelizable":false,"serialReason":"历史阶段实际串行","resources":[]},
    "deliverables": [{"name":"checkpoint","required":true,"acceptance":"可加载","status":"ready","evidence":"archive/model.pt"}],
    "metrics": [{"key":"Accuracy","value":0.91,"operator":">=","targetValue":0.90}
  }
}
```

审计补录只能填充原本为空的 `createdAt/startedAt/deadlineAt/completedAt/executionPlan/deliverables/metrics`，不能覆盖已有字段、状态或结果。每次补录都会记录 `auditSupplements[]`，包含时间、字段列表和授权原因。

### 6.2 逾期合法交付后的自动推进

当阶段已经超过 `deadlineAt`、质量门未通过，但所有必需交付物均 `ready` 且有证据时：

1. 立即将当前阶段标记为 `overdue`；
2. 插件返回 `mustContinue=true`、`nextPhaseAllowed=true` 和 `nextPhaseId`；
3. Agent 必须使用该合法交付物立即启动下一阶段，不得停下来等待用户审批；
4. 只有缺少用户专属输入、权限、安全确认或存在无法自主解决的外部阻塞时，才允许询问用户。

Tool 卡片会直接显示“允许立即启动下一阶段”和“不要等待用户审批”。下一阶段只在前序阶段已合法终态（`completed` 或交付物齐备的 `overdue`）时允许启动。

## 7. 后台任务巡检

启动后台任务前预估总耗时。初始普通巡检仅安排：

1. 5分钟；
2. 预计时间50%；
3. 预计时间75%。

预计时间100%是**结果收获点**，用于收获最终产物并判断是否结束，不是普通巡检。每次巡检都必须检查：

- 是否存在空闲但可利用的GPU、CPU、后台作业、子进程或subagent；
- 慢分支能否进一步拆分；
- 是否可新增独立并行工作；
- 每个资源分支是否已经产出预期交付物；
- 是否需要重新平衡或停止无效分支。

### 7.1 如何判定巡检时“未结束”

在任一计划巡检点，满足下列任一条件即判定任务未结束：

- 后台进程或作业仍为 running；
- 阶段状态仍是 `pending` 或 `in-progress`，尚未进入 `completed`/`overdue`；
- 仍有任一结构化质量硬目标未达标；
- 任一必需交付物不是 `ready`，没有验收证据，或无法供下一阶段消费；
- 仍有明确剩余工作量。

不能仅凭命令暂时没有新输出判断完成；必须读取任务状态、产物和硬目标指标。

### 7.2 未结束后的递归重估

任何巡检点或100%结果收获点发现未结束时，都应立即根据当前完成度、处理速度、剩余样本/步骤和最近一轮耗时，重新估计**剩余时间**，并重新分析可用并行资源、慢分支和可新增分支，更新 `executionPlan`。从此不再沿用原巡检表，只安排新剩余时间的两个检查点：

1. 剩余时间的50%；
2. 剩余时间的100%。

若新的100%巡检点仍未结束，应再次重估剩余时间，并再次只安排50%和100%两个巡检点。如此递归重复，直到任务：

- 质量达标且交付物齐备，标记 `completed`；
- 超时、质量未达标但交付物齐备，标记 `overdue`；
- 出现需要用户处理的明确阻塞。

若超时但交付物仍缺失，不属于可结束条件，必须继续重估和执行。

重估后禁止恢复5分钟或75%巡检，也禁止在两个检查点之间额外轮询。

**示例**：原预计60分钟；60分钟时仍未结束，估计还需20分钟，则下一轮只在10分钟和20分钟后检查。20分钟后仍未结束，重新估计还需8分钟，则只在4分钟和8分钟后检查。

超过半小时的任务必须主动设计巡检策略。`introduction` 简要记录巡检时间与每次重估结果，阶段 `result` 记录巡检指标、剩余时间判断和调整结果。

## 8. UI 表达

总览统计口径：`completed + overdue` 都计入“已结束/终态进度”；质量达标率单独统计。只要仍有 `pending`，总状态就显示“待开始”，不能显示“全部完成”。Tool 调用成功或失败均在调用卡片中显示文本，不再静默。

每个阶段显示：

- 创建、开始、截止时间；
- 当前硬目标与门控通过/未通过状态；
- 预计耗时、初始巡检点和100%结果收获点；
- 并行/串行判断、资源分支及各分支预期交付物；
- 当前完成度；
- 尝试次数；
- 最近一次调研结论和下一轮调整；
- 最终结果或逾期结果。
