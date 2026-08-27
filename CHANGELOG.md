# Changelog

## 1.2.0 — 2026-08-26

- Rebrand the project from BigPlan to ProgressTarget.
- Rename the package identifier to `dsh-progress-target`.
- Update documentation, prompts, and social copy to the new name.

## 1.1.0 — 2026-08-26

- Replace deployment-specific hard-coded GPU server names with `requiredServers` configuration.
- Add configurable resource snapshot freshness and storage directory.
- Allow CPU-only, autoscaled, scheduler-backed, and dynamically discovered environments.
- Reject duplicate server entries while allowing additional discovered resources.
- Add a systematic deployment configuration and portability audit.
- Generalize prompts, schemas, guides, and examples.

## 1.0.0 — 2026-08-26

- Add per-session persistent semantic execution plans.
- Add structured quality gates and evidence-backed deliverable gates.
- Add deadline-aware `completed` and `overdue` semantics.
- Add retry diagnosis and adjustment audit records.
- Add parallel resource planning and recursive monitoring schedules.
- Add full discovery of four default GPU servers.
- Require fresh server discovery at phase start, transition, and replan.
- Add resource discovery history and visible snapshot generations.
- Add DSH Web conversation progress dashboard.
