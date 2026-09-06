# ProgressTarget for Codex

**English** · [简体中文](README.zh-CN.md) · [Repository home](../README.md)

Version **0.1.0**. A Codex skill, five MCP tools, optional lifecycle hooks, and a local progress dashboard. Each Codex conversation owns its plans and history, even when multiple conversations share the same workspace or MCP process.

## Install

Requires Node.js 22+ and a Codex CLI that supports `codex plugin`.

From this `codex/` directory:

```sh
npm ci
npm run build
codex plugin marketplace add .
codex plugin add progress-target@progress-target
```

Windows users can double-click `安装插件.cmd`. The installer builds missing runtime bundles, generates paths for this directory, registers its marketplace, and installs the plugin. A source checkout needs npm for its first build. A prepared release ZIP already contains runtime bundles and needs only Node.js and Codex to install.

Open a new Codex task after installation to load the tools and skill. Re-run the installer after relocating this directory. The marketplace name is `progress-target`, separate from a personal marketplace.

## Daily workflow

Say “Use ProgressTarget to plan [task] in this conversation; do not execute yet.” The agent reads the installed skill and its relative guide, saves a paused plan, and returns the current conversation's dashboard link. When ready, say “Start executing the current plan.” See the [full workflow and prompts](docs/usage.md).

The five tools are `plan_create`, `plan_get`, `phase_update`, `plan_manage`, and `plan_open`. They require the caller's actual `threadId`; a shared working directory, root session, or MCP server process cannot substitute for it.

## View progress

Ask “Open this conversation's ProgressTarget dashboard.” `plan_open` returns a local URL scoped to this task. Open it in a browser, or in a client webpage panel when available. It shows phases, metrics, deliverables, deadlines, resources, attempts, history, JSON export, and live updates.

On Windows, `启动看板.cmd` starts the service and `停止看板.cmd` stops it. The default port is 18765; a busy port triggers a free-port fallback. The actual address is written to `runtime/dashboard.json`. An unscoped URL shows an entry page; it never picks someone else's plan. To preview synthetic data, run `npm run demo` and select the explicit demo entry.

## Data and configuration

All source, generated configuration, runtime data, logs, and release files stay under this directory. Codex also maintains its own installation metadata and cache.

| Path | Purpose |
|---|---|
| `plugins/progress-target/` | Plugin manifest, skill, MCP, hooks, shared rules, and UI |
| `.agents/plugins/marketplace.json` | Local marketplace |
| `runtime/data/plans/` | Persistent plan bodies |
| `runtime/data/threads/<threadId>/current.json` | Per-conversation current-plan pointer |
| `plugins/progress-target/local-config.json` | Generated project path, port, resource configuration |
| `tests/`, `scripts/`, `docs/` | Tests, lifecycle utilities, and documentation |
| `dist/` | Generated release ZIP |

`requiredServers` defaults to an empty list. Configure it only if your deployment requires a fixed resource inventory. Private runtime data and generated absolute paths are ignored by Git and excluded from public ZIPs. Existing evidence paths remain historical records when the project moves.

## Capabilities and limits

The plugin enforces researched v2 quality metrics, justified thresholds, required deliverables, dependency order, Beijing-time deadlines, protected history, explicit migration, revision checks, and atomic persistence. Plans start paused. Legacy v1 plans can be imported and continued without a forced upgrade. See the [full guide](plugins/progress-target/GUIDE.md) and [feature comparison](docs/feature-audit.md).

The dashboard is read-only. The executing agent supplies resource observations and evidence; the plugin does not run SSH/GPU jobs, verify external measurements, schedule model wakeups, or bypass host limits. Optional SessionStart, Stop, and Interrupt hooks require host trust. Their code is tested, but trusted native event dispatch remains a separate acceptance step; do not assume installation activates them.

## Development and packaging

```sh
npm ci
npm run build
npm test
node scripts/verify-ui.mjs
npm run package
```

UI checks use synthetic plans in an isolated directory and require installed Chrome (or `PT_BROWSER_CHANNEL=msedge`). No real task or running dashboard is needed. Packaging requires Python 3; prepared runtime bundles do not. Windows release and launcher checks are documented in [development](docs/development.md).

MIT © 2026 02TJS. See [LICENSE](LICENSE) and [third-party notices](plugins/progress-target/THIRD-PARTY-NOTICES.md).
