# DSH → Codex 功能对照

本仓库保留 DSH 2.0.1 与 Codex 0.1.0 两个独立实现。Codex 的规则迁移基线为 DSH 2.0.0；DSH 2.0.1 另修复了工具与 HTTP 的完整 v2 初始化和已有计划保护。Codex 对应入口是 `plan_create`，已有独立的初始化、历史和并发测试。

规则与前端已迁移，宿主接口分别适配。下面区分已实现规则、宿主替代和待完成的真实 Hook 事件验收，不把独立进程测试视为宿主自动化已经生效。

## 功能对照

| DSH 特性 | Codex 迁移状态与实际行为 | 核对位置或证据 |
|---|---|---|
| 每个会话自己的计划 | 每次工具调用必须携带当前 threadId；相同目录、共享 MCP 进程、共享根 session 的分叉均独立 | core/storage.js、server/mcp.js；workflow.test、integration.test |
| 当前会话的前端页 | 工具生成当前对话专属 URL；列表、详情、导出均校验归属，新对话为空，演示显式访问 | server/dashboard.js、ui/app.js；22 项浏览器检查 |
| init-plan 新建完整计划 | 已迁移为 plan_create，保存 v2 完整契约；修复原 DSH Agent 初始化缺失字段的问题 | core/operations.js；core.test、MCP 集成 |
| 制定计划但暂不执行 | 整体 paused、阶段 pending；Stop 不催促执行。资源可 deferred，未实测值为 null | workflow.test；GUIDE“先制定” |
| 修改计划但暂不执行 | revise-plan：重订 pending 指标、交付物与安排，自动保留非 pending 历史并暂停；删阶段仍需授权 | operations.js；workflow.test |
| 已有历史的新一轮规划 | 保留原计划与历史；未收尾时修订当前计划，最终收尾后可同对话新建下一份。避免 init 静默覆盖 | 同对话并发创建和新计划历史测试 |
| 第一性原理、最小充分、无默认 SHA/manifest/额外报告/消融 | 已迁移为指南与 Skill 规则；不自动制造附加阶段或报告 | GUIDE、SKILL、usage.md；规则属于代理行为，非结构校验能完全保证 |
| finalObjective、最终交付物 | 已迁移；另补独立 finalize 最终实测验收，阶段全结束不自动等于目标达成 | operations.js、continuation.js；core.test |
| metricResearch 研究来源、候选、选择与局限 | 已迁移；已选质量指标须匹配调研结果。一个充分候选即可 | contract.js；前端展开“指标依据” |
| quality/process/final 分类、有效阈值与 adaptive 冻结 | 已迁移；质量门不能只用过程指标或全用 >0/≥0；迁移时在 pending 创建时也校验 | contract.js；workflow.test |
| 阶段贡献、证据等级、验证安排、不确定性、未知贡献 null | 已迁移；补齐首版前端遗漏的证据等级和验证安排 | contract.js、ui/app.js |
| 五种指标比较与全体门控 | 已迁移；迁移时修复 null 被转换为 0、对低值目标误判达标的问题 | contract.js；workflow.test |
| 必需交付物 ready + evidence | 已迁移；迁移时补齐证据类型、required 类型和执行后验收定义保护 | core.test、boundaries.test |
| 前序合法结束后才能启动下游 | 已统一到共享核心；修复原 HTTP 与 Agent 分支条件不同 | operations.js；core.test |
| 北京时间、创建/开始/截止/结束时间 | 已迁移；拒绝 Z、无时区、无效日历及未来开始时间，终态历史受保护 | contract.js；core.test、workflow.test、boundaries.test |
| completed 与合法 overdue | 已迁移并分别统计质量通过率与阶段结束率；缺产物不能到期离场 | core.test、浏览器逾期场景 |
| 未完成时 summary/findings/adjustment | 已迁移；前端补齐最近记录的 findings。完整尝试历史仍保存在计划并可导出 | contract.js、ui/app.js |
| 资源清单、全服务器查询、新鲜度 | 已迁移；仅规划允许 deferred，实际启动与重规划强制真实快照 | contract.js；core.test、workflow.test |
| 快照晚于前序结束及上一代、历史代次 | 已迁移，保留 resourceDiscoveryHistory | contract.js；core.test |
| 多可用服务器分片、分支覆盖、串行理由 | 已迁移；迁移时补每个相关资源分支必须填写 shard 的检查 | contract.js；workflow.test |
| 初始 5min/50%/75% + 100% 收获 | 已迁移；前端明确把 100% 显示为结果收获点 | contract.js、ui/app.js |
| 未结束后重估为剩余 50%/100% 并递归 | 已修复原版每次重建初始检查点的问题。到点测量、重估与查询仍由执行代理负责 | core.test；GUIDE“资源查询” |
| 不以固定尝试轮数停止 | 指南与续跑判断已迁移；遵守用户暂停、真实阻塞与宿主限制，不承诺绕过宿主限额 | continuation.js、GUIDE |
| 结束阶段保护、明确授权删除、只补空审计字段 | 已迁移；普通同状态写入也不可篡改终态，删除保留记录 | operations.js、contract.js；core.test |
| v1 兼容、显式完整 v2 迁移 | 迁移时补齐完整 v1 补充、修订、追加、执行与收尾；不强迫升级或编造最终测量。显式迁移保留原实测值、阈值、交付记录、资源安排与审计历史 | parity.test、SDK 进程集成 v1 全流程、core.test |
| 资源配置与存储位置 | requiredServers 和资源有效期移到 local-config.json，非法零值拒绝；按用户集中管理要求，dataDir 固定在项目 runtime/data，旧 DSH 的路径配置不直接沿用 | config.js、parity.test；这是明确的部署适配 |
| 语义化阶段 ID | 中文及原有语义 ID 可继续使用，重复 ID 被拒绝；文件路径的 planId/threadId 校验独立保留 | operations.js、parity.test |
| 历史终态审计补录 | 只补空字段，不覆盖；v2 补录保留测量与阈值元数据。原审计与截止变更记录迁移后保留 | parity.test |
| 最终验收留存与导入副本 | Codex 新增功能经复核加强：不可重复覆盖已收尾验收；追加必要阶段或导入副本保留原事件和 finalAcceptanceHistory | parity.test |
| 磁盘保存、恢复、并发写入 | 原子替换、计划锁、对话创建锁、revision 保护；中断使用锁内最新状态，损坏文件不阻断其他对话 | storage.js；core.test、workflow.test、boundaries.test |
| DSH 工具结果卡、mustContinue/下一阶段提示 | **宿主替代**：5 个 MCP 工具的结构化结果；continuation 明确提供 mustContinue、nextPhaseAllowed、nextPhaseId、requiresUserInput。合法逾期交付后立即推进，暂停时不推进；卡片外观与原调用参数不兼容 | server/mcp.js、continuation.js；parity.test 与真实 SDK 集成 |
| DSH conversation.view 内嵌进度标签 | **宿主替代**：本地只读网页，可在系统浏览器或支持网页面板的客户端查看；不注入任意原生标签 | dashboard、22 项浏览器检查 |
| 前端自动刷新、指标/交付物/时间/资源/尝试/v2 信息 | 已迁移并补齐显示遗漏；SSE 通知后重读，断线时本地 10 秒兜底，不调用模型。旧格式独立收获点、逾期执行中与缺指标历史也能展示 | scripts/verify-ui.mjs |
| DSH 注册和原 HTTP 更新 API | **不保留原协议**：Codex manifest、Skill、stdio MCP 与只读 HTTP 看板接替；更新经过同一服务 | 插件校验、MCP 集成 |
| 宿主结束前继续与中断响应 | **可选宿主适配**：代码已测试，开发宿主识别到三个未信任 Hook；安装后仍需信任并验证真实触发与身份取得 | Hook 独立进程、分叉、并发中断测试；scripts/inspect-host-hooks.mjs |
| 自动启动 SSH/GPU 实验、后台计时唤醒 | 原 DSH 也没有提供独立执行器或调度器，因此不是迁移丢失。由代理与宿主授权工具负责 | 原 index.js/client.js、GUIDE、当前服务职责 |

代码位置均相对 `plugins/progress-target`，测试位于项目 `tests`。数据集中存放与各对话计划独立不矛盾：`runtime/data/plans/<planId>.json` 是正文，`runtime/data/threads/<threadId>/current.json` 是该对话自己的当前计划指针。不是所有对话共用一个 current-plan.json。

## 验证方式与边界

`npm test` 运行核心契约、对话隔离、v1 兼容、并发/损坏边界，以及实际 stdio MCP 和 Hook 子进程测试。`node scripts/verify-ui.mjs` 使用隔离的合成计划执行 22 项浏览器检查，覆盖页面展示、归属、SSE、断线刷新、旧格式和异常恢复。可复查的测试代码随仓库发布，本机日志和个人任务记录不随仓库发布。

开发阶段的 Codex Desktop 0.153.1 已识别 SessionStart、Stop、Interrupt 三个 Hook，但它们未获信任。因此不能声称自动恢复、结束前继续或中断保存已经生效。安装后需按[官方 Hook 文档](https://learn.chatgpt.com/docs/hooks)完成用户信任，再验证真实事件以及当前对话身份。插件不会替用户开启信任。

没有通过本仓库测试执行真实 GPU 实验。证据字段的结构校验不能证明外部测量成功，检查点也不会自行唤醒模型。完整操作顺序见[使用流程](usage.md)。
