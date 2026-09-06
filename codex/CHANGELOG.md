# Changelog

## Repository integration — 2026-09-06

- Add a separate `codex/` package alongside DSH, with English and Chinese installation guides.
- Generate installation paths locally; exclude personal plans and local QA output from public packages.
- Make browser validation self-contained with synthetic plans. The demo command creates only explicit demo data.
- Keep the plan service, per-conversation isolation, quality gates, MCP tools, and dashboard behavior from 0.1.0.


## 0.1.0 边界复核更新 · 2026-09-05

- 拒绝空证据被转成有效文字、布尔/数组被转成最终数值、异常 required 标志、重复指标/产物及矛盾的重复最终测量。
- 执行后冻结测量方法、单位和产物验收条件；拒绝无效日历日期及未来开始时间。
- Interrupt 在写锁内应用到最新状态，保留同时写入的进度且不重开已完成验收；重复中断不追加记录。
- 修复 v2 导入丢弃已校验契约及已收尾 v1 迁移后无法做 v2 最终验收的问题；迁移后保持暂停和历史留存。
- 单个计划损坏不再阻断其他对话的列表；MCP 和看板提示不完整，原文件保留。
- 复现 14 个失败边界场景与 2 个通过对照；补充真实 Codex MCP 读取和桌面宿主 Hook 清单检查。宿主识别全部三个 Hook，但目前均未信任、不会自动触发。

## 0.1.0 全特性复核更新 · 2026-09-05

- 补齐 v1 指标/交付物更新、pending 修订、阶段追加与收尾，不强迫升级 v2。
- 迁移保留原阈值、实测值、交付记录、资源安排、截止变更与补录；历史快照不受新增服务器配置追溯限制。
- v2 审计补录保留指标元数据；最终验收禁止直接覆盖，后续工作和导入副本保留原事件及验收历史。
- 恢复明确的下一阶段推进字段，支持中文阶段 ID，拒绝非法零值资源有效期。
- 看板补齐完整说明、阶段标签、文字时间安排、逾期执行中、独立交付门、旧格式收获点和年份；断线后本地读取恢复，展开状态保留，删除后恢复空白。
- 原版对照、修改前失败记录、核心与真实 MCP 回归、20 项浏览器检查集中保存在项目内。

## 0.1.0 本地更新 · 2026-09-05

- 按真实 Codex threadId 隔离当前计划、历史、MCP 操作、Hook、看板与导出；相同目录和共享根 session 不再混用计划。
- 新建默认暂停，增加 revise-plan 完整修改 pending 契约并保留执行历史；禁止静默覆盖尚未收尾的计划。
- 仅制定计划时允许 deferred 资源查询、null 未测量指标；实际执行必须重新查询真实资源，空值不再误判通过。
- 补齐前端遗漏的发现、指标依据、证据等级、验证安排及资源分片；演示使用显式入口。
- 增加完整 GUIDE、原提示词的 Codex 用法与逐项迁移核对，新增 11 项核心/接口测试和 5 项浏览器隔离检查。

## 0.1.0 · 2026-09-05

- 从 DSH 2.0.0 抽取统一规则，迁移为 Codex Skill、MCP 与可选 Hook。
- 修复工具初始化缺失、前序验收差异、迁移重写结束时间和普通更新改写终态的问题。
- 增加原子存储、并发版本检查、任务绑定和独立最终验收。
- 提供浏览器实时看板、演示计划与本次迁移的开发验收计划。
- 将源码、配置、状态、验证和交付包集中到单一项目目录。
