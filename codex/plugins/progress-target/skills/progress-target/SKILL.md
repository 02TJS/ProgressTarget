---
name: progress-target
description: 为当前 Codex 对话维护独立的持久化计划，先制定或修改再按授权执行，检查质量与必需交付物并打开专属看板。用户要求用 ProgressTarget、制作新计划、修改现有 ProgressTarget 计划、开始或恢复计划执行及查看计划进度时使用。
---

通过本插件的 plan_create、plan_get、phase_update、plan_manage 和 plan_open 工具工作。

制定或修改计划前完整阅读 [GUIDE.md](../../GUIDE.md)，需要参数形状时再读 [v2 示例](references/contract.md)。按真实依赖拆分最小充分阶段，不默认增加 SHA、复现说明、manifest、额外报告、消融或重复审计。不要编造指标、资源状态或证据。

- 从当前任务的可信 Hook 上下文或当前任务自己的 shell 读取 CODEX_THREAD_ID。可在当前工作目录运行本插件 scripts/current-context.mjs（相对本 SKILL.md 为 ../../scripts/current-context.mjs）。它只读取身份。每个工具都必须传真实 threadId；不要用 CODEX_SESSION_ID、目录、进程号、共享 MCP 服务环境或其他对话的 ID 替代。
- 先 plan_get({threadId,detail:true})。plan:null 表示本对话没有计划，不能去全局挑选。无法确认身份时停止计划读写并说明原因。
- 用户说“制作新计划，暂不执行”：plan_create 保持 executionState=paused、全部阶段 pending；未知实测值为 null，资源发现使用 deferred 与原因，执行分支仅 planned，不启动任务或查询、占用资源。
- 用户说“修改现有计划，暂不执行”：先读 revision，使用 plan_manage 的 revise-plan 更新 pending 部分；完整 timeline 只包含所需保留的 pending 阶段，执行历史自动保留；修改后仍 paused。新增或精简指标、交付物可通过该入口实现，删除阶段仍需明确授权。
- 用户明确要求开始或继续后才 set-execution active。阶段启动必须提供新查询的真实资源快照与 executionPlan，不能使用 deferred。在当前对话制定再执行，不另建 Codex 对话。
- 每次修改先读取 revision，并通过 expectedRevision 提交。冲突时重新读取，不覆盖他人的更新。
- phase_update 的指标可以只传 key/value，交付物可以只传 name/status/evidence。标识不能重复，evidence 必须是实际文字证据，required 必须是布尔值。未完成阶段按要求记录 attempt。开始之后不能改换阈值、测量方法、单位或交付标准，也不能移除必需交付物。
- completed 要求质量通过、必需交付物有证据且未超过截止时间。合法 overdue 可以推进，但不代表质量通过。终态通过普通更新不可改写。
- 阶段未结束且仍有可执行工作时继续推进；不用固定重试轮数停止。用户暂停、中断、缺少专属输入或真实外部阻塞时，记录相应执行状态。
- 等待作业用 plan_manage set-execution 的 waiting 状态并记录检查时间。这个插件不提供后台调度；使用当前宿主可用且已获用户授权的等待或自动任务功能。
- 用户要看进度时调用 plan_open({threadId})，返回并打开包含当前对话范围的链接；不要省略 thread 参数。新对话看板为空，演示数据从显式入口查看。页面自动刷新，不需要模型轮询。
- 所有阶段结束后，还需实际测量最终目标，再用 finalize 记录最终验收。部分逾期交付必须如实说明未达成的指标，不能把阶段结束率当作目标达成率。
- 对已有 v1 计划，允许按旧契约补充指标/交付物、修订 pending 部分、追加阶段和执行；全部阶段合法结束后 finalize 仅记录 v1 收尾，不强迫迁移或编造最终测量。用户明确授权 migrate-plan 时才升级 v2，并保留原阈值、实测值、产物与历史。
- 合法逾期交付后，遵循 continuation.nextPhaseAllowed/nextPhaseId 立即推进下一阶段，不重复索取已经获得的执行授权。已完成的最终验收不可覆盖，必要后续工作会保留原验收历史。

时间统一使用带 +08:00 的 ISO 8601。指标调研和证据达到决策所需程度即可，不增加无用审计。

显式 v1→v2 迁移后保存为 paused；旧收尾记录仍保留，新最终目标另行实测验收。历史列表的 warnings 表示有文件无法读取，列表可能不完整；不要据此替换当前计划或修补未知历史。

历史导入、迁移、删除和终态补录使用 plan_manage，仅在已有真实用户授权时提交 userAuthorized=true 与 reason。详见 [管理与恢复](references/management.md)。Hook 需要宿主信任；不替用户开启信任，也不把未运行的 Hook 描述为有效保障。
