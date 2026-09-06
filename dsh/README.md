# DSH ProgressTarget

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

> Make AI agents finish long-running work—not merely write a checklist.

DSH ProgressTarget is a persistent planning and execution-control plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It adds semantic phases, quality gates, deliverable gates, deadlines, auditable retries, multi-resource execution plans, and dynamic GPU discovery to each conversation.

## Why ProgressTarget?

Ordinary agent plans often fail in predictable ways: phases are declared complete without usable artifacts, metrics are vague, deadlines silently slip, GPU availability becomes stale, and the agent pauses for confirmation even when it could continue autonomously.

ProgressTarget turns a plan into an enforceable execution contract:

- **Persistent per-session plans** — every conversation owns an independent plan.
- **First principles and minimal sufficiency** — add no phase, metric, artifact, evidence, or audit unless it changes a decision, validates final quality/usability, protects safety, or serves a real downstream requirement.
- **Semantic phases** — split by real dependencies, not mechanical quarters.
- **Two hard gates** — quality targets and usable deliverables are evaluated separately.
- **Goal-linked phase quality** — each v2 phase explains how its quality protects or validates the final objective.
- **Research before metrics** — compare candidate proxies, cite sources, define measurement and limitations, and justify thresholds before execution.
- **Honest uncertainty** — unknown impact magnitude stays `null`; choose only the least costly validation that the final objective actually requires instead of fabricating precision or defaulting to extra experiments.
- **Beijing-time deadlines** — every timestamp is stored with the explicit `+08:00` offset and displayed in Asia/Shanghai, independent of Host or browser timezone.
- **Deadline-aware outcomes** — `completed` means passed on time; `overdue` means late but still usable.
- **Evidence-first delivery** — required artifacts need acceptance criteria and evidence.
- **Dynamic resource discovery** — refresh all configured GPU servers at phase start, transition, and replan.
- **All-server sharding** — shardable inference, evaluation, and data work must use every available server.
- **Auditable retries** — record result summaries, findings, and explicit adjustments.
- **No continuation-round ceiling** — while still before the deadline and an actionable adjustment exists, the agent must keep researching and retrying; attempt count or continuation budget is not a valid stop reason.
- **Recursive re-estimation** — unfinished work gets a new 50%/100% schedule instead of busy polling.
- **Visible progress UI** — inspect phases, metrics, artifacts, retries, deadlines, and resource snapshots in DSH Web.

## Execution model

```text
Plan → discover resources → start phase
  ↓
5 min / 50% / 75% checks → 100% harvest
  ↓
quality gate + deliverable gate + deadline gate
  ├─ all pass on time → completed → refresh resources → next phase
  ├─ quality misses, artifact ready, timed out → overdue → refresh resources → next phase
  └─ artifact missing → remain in-progress → diagnose → replan → retry
```

[Back to repository overview](../README.md). The Codex plugin has its own [installation guide](../codex/README.md).

## Installation

The `dsh/` directory is a DSH Profile Bundle. Add it to the Profile that owns your Web GUI (the Profile name is deployment-specific):

```powershell
dsh plugin --profile <your-profile> add <path-to-ProgressTarget>/dsh
```

Restart the existing DSH Web Host after installation. Do not start a replacement Vite server: the running DSH Host injects the Web boot state.

For development, copy or link the `dsh/` directory into your user-owned DSH plugin directory, add the package to the Web profile, and rebuild/restart the affected Web artifacts as required by your DSH checkout.

## Quick start

After installing, ask the agent to read [`GUIDE.zh-CN.md`](GUIDE.zh-CN.md), then call `update-progress-target` while executing your task.

```text
请执行 [XXX任务]。开始前先完整阅读本仓库的 GUIDE.zh-CN.md，并使用 update-progress-target 为当前会话建立独立计划。按真实依赖拆分语义阶段；每阶段必须设置 deadlineAt、结构化质量硬目标、可供下一阶段消费的必需交付物及验收证据、executionPlan 和资源分支。建立计划、启动阶段、阶段转换和重规划时，都要重新查询全部配置服务器的实时资源状态，不能复用旧快照。除非缺少用户专属输入、权限、安全确认或遇到无法自主解决的外部阻塞，否则持续推进到完整计划结束。
```

The full production prompt is available in [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md).

## Configure your deployment first

ProgressTarget ships with **no universal server inventory**. Server names, discovery commands, quality thresholds, artifact rules, storage, deadlines, permissions, and resource limits are deployment-specific.

Configure the bundle in `cordis.patch.yml`:

```yaml
config:
  requiredServers:
    - gpu-a
    - gpu-b
  resourceDiscoveryMaxAgeMinutes: 10
  dataDir: .progress-target
```

An empty `requiredServers: []` disables fixed-inventory enforcement and supports CPU-only, cloud-autoscaled, scheduler-backed, or dynamically discovered environments. If configured, every resource snapshot must cover all listed servers; additional discovered servers remain allowed.

Read the complete [configuration and deployment audit](CONFIGURATION.md) before production use. ProgressTarget validates evidence supplied by the agent; it does not create SSH connectivity, scheduler integration, credentials, GPUs, timers, or background-job capabilities.

## State semantics

| State | Meaning |
|---|---|
| `pending` | Planned but not started |
| `in-progress` | Active; may include retries or deadline re-estimation |
| `completed` | Quality and deliverable gates passed before deadline |
| `overdue` | Deadline passed, quality may miss, but required deliverables are usable |

Required deliverables block downstream phases even after timeout. All history is protected by default. With explicit current user authorization, `delete-phase` can remove a phase in any state and `delete-plan` can permanently remove the session's entire plan. Both require `userAuthorizedDeletion=true` and a non-empty reason; authorization must never be inferred. Phase deletion is recorded in `deletionAudit`.

## Storage

Plans are stored per session under:

```text
<DSH_CWD>/.progress-target/<sessionId>.json
```

Do not commit runtime plan files: `.gitignore` excludes `.progress-target/`.

## Security and privacy

- Review resource evidence before publishing screenshots or plan JSON.
- Never place credentials, private SSH keys, tokens, or confidential dataset paths in evidence fields.
- The plugin records evidence supplied by the agent but does not manage cluster credentials.

## v2 quality-contribution contract

New plans use `schemaVersion: 2` and must define a structured `finalObjective` with final metrics and deliverables. Every phase must then provide:

- `metricResearch`: research questions, traceable sources, candidate metrics, selected metrics, and selection rationale;
- `objectiveContribution`: linked final metric keys, causal mechanism, evidence level, uncertainty, risk if missed, and a validation plan;
- metric metadata: `kind`, measurement method, limitations, and threshold provenance.

A v2 phase cannot pass with process-only metrics such as “job finished” or “file created.” At least one researched `quality` or `final` metric must protect, improve, or validate the final objective. Vacuous existence thresholds such as `count > 0`, `files > 0`, or a set of quality metrics that are all merely `> 0`/`>= 0` are rejected. An `adaptive` threshold is exploratory only and must be frozen to a justified formal threshold after sufficient research or measurement before the production phase can proceed. If the impact magnitude cannot yet be estimated, `impactEstimate` should be `null`; the phase must state uncertainty and use only the minimum validation needed by the final objective instead of inventing a number or requiring a pilot, ablation, or reproduction package by default.

## Initialization, compatibility, and migration

The Tool now accepts a top-level `phases` array. `operation="init-plan"` reads `phases`, creates every phase as `pending`, and does not require `phase_id`; do not send a top-level `timeline` string during initialization because it is not persisted. Each `phases[].timeline` remains the human-readable time string for that single phase. For `operation="update-phase"`, the top-level `timeline` field is likewise the human-readable string for the one phase being updated. Separately, the HTTP endpoint still accepts the legacy top-level `timeline` object array for transport compatibility. Persisted v2 files always use `schemaVersion: 2` and store phases in the `timeline` object array.

Initialization is create-only. If any plan file already exists—even a historical file with an empty `timeline`—initialization fails explicitly and leaves that file unchanged. There is no terminal-phase concatenation and no silent v1 fallback. Existing plans, including legacy plans, remain editable through `operation="update-phase"`.

Migration is explicit and transactional. `operation="migrate-plan"` requires `userAuthorizedMigration=true`, a non-empty reason, a complete `finalObjective`, and a `phases` array matching the existing phase count, order, and IDs. Migration only adds `metricResearch`, `objectiveContribution`, and metric metadata while preserving every original metric value and all other fields, statuses, and timestamps. After the call, re-read the stored plan and verify `schemaVersion`, phase count, and ordered IDs; a successful Tool card alone is not proof of completion. If validation fails, the original file remains unchanged. Deleting an old plan requires an explicit `delete-plan` authorization with `userAuthorizedDeletion=true` and a reason. See the [full v2 contract and migration example](V2-CONTRACT.zh-CN.md).

## Documentation

- [v2 quality-contribution contract (Chinese)](V2-CONTRACT.zh-CN.md)
- [Configuration and deployment audit](CONFIGURATION.md)
- [Complete Chinese guide](GUIDE.zh-CN.md)
- [Production prompt template](PROMPT.zh-CN.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
