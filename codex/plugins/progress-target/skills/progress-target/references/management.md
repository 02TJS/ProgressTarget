# 管理与恢复

每个工具必须传当前任务的真实 threadId。planId 可省略以使用该对话当前计划；显式 planId 也必须属于该对话。已有计划写操作需要最新 expectedRevision；认领无归属旧计划同样需要 revision。不要使用根 session ID。

| operation | 额外参数 |
|---|---|
| revise-plan | 可选 title/introduction/finalObjective；timeline 若提供，是修改后全部 pending 阶段。执行历史自动保留；有执行历史时目标冻结；删阶段需明确授权。保存为 paused |
| set-execution | state 为 active/waiting/paused/blocked；非 active 时填写 reason；waiting 可带 waitingUntil |
| bind | 明确 planId；仅允许本对话已有计划或获准认领的无归属旧计划；后者需 userAuthorized/reason/revision。禁止抢占其他对话或覆盖未收尾绑定 |
| append-phase | 与当前 v1/v2 格式一致的完整 phase；用于新增必要阶段。已存在的最终验收会归档保留 |
| finalize | v2 用 metrics: [{key,value,evidence}] 和 deliverables: [{name,evidence}] 覆盖全部最终目标；v1 则在全部阶段合法结束后直接收尾，不需要未定义的最终测量；已收尾验收不可重复覆盖 |
| import-plan | plan JSON、workspaceRoot、可选 originSessionId/title、userAuthorized=true、reason；新副本归属当前 threadId，默认暂停 |
| migrate-plan | 完整 finalObjective、与旧阶段一一对应的 timeline、userAuthorized=true、reason |
| audit-phase | phaseId、supplement、userAuthorized=true、reason；只补终态空缺字段 |
| delete-phase | phaseId、userAuthorized=true、reason |
| delete-plan | userAuthorized=true、reason |

导入创建独立副本并默认暂停。旧计划没有 schemaVersion 时按 v1 处理，revise-plan 和 append-phase 仍可使用 v1 契约；finalObjective 只能经显式 migrate-plan 引入。迁移保留原阈值、实测值、交付状态与证据、实际资源安排、补录、截止变更和历史时间，失败不改写原文件。历史快照不必包含当前部署新增的服务器，实际执行时仍必须查询全部当前配置。

导入的事件和最终验收历史会保留。新工作使原最终验收不再代表当前计划时，旧验收进入 finalAcceptanceHistory，而不是被清空丢弃。

删除计划的审计记录保存在运行目录的 deletion-audit 中。userAuthorized 是对既有用户授权的记录，不是自行取得授权的方法。

Hook 使用 SessionStart 恢复当前 threadId 的绑定，Stop 只检查可以继续的 active 计划，Interrupt 记录该对话暂停。缺少可靠 threadId 不选择计划。更新插件后若旧工具架构未刷新，先重新加载客户端再回到原任务；测试插件加载也可使用新的任务。日常新建计划不要求另开 Codex 对话。等待状态不会创建计时器；只有宿主再次运行时才能判断是否继续。
