# Changelog

## 2.0.0 — 2026-08-26

- Preserve plans without `schemaVersion` as fully compatible v1 plans.
- Require all newly initialized plans to use the v2 quality-contribution contract.
- Add structured final objectives and final deliverables.
- Require phase metric research, traceable sources, candidate comparison, and selection rationale.
- Require phase-to-final-objective mechanisms, evidence levels, uncertainty, risks, and validation plans.
- Add metric kinds, measurement methods, limitations, and threshold provenance.
- Allow unknown impact magnitude to remain null rather than inventing precision.
- Reject v2 phases that rely only on process metrics.
- Show plan contract version and objective contribution in the Web UI.

## 1.2.0 — 2026-08-26

- Rebrand the project to ProgressTarget.
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
