# ProgressTarget

**English** · [简体中文](README.zh-CN.md)

Persistent plans, measurable quality gates, and visible progress for AI agent tasks. Each conversation owns its plan. Plan first, then explicitly authorize execution.

This repository contains two independently installable plugins:

| Platform | Version | Progress view | Installation and usage |
|---|---|---|---|
| DeepSeek Harness (DSH) | 2.0.1 | Progress tab in DSH Web | [DSH plugin](dsh/README.md) |
| Codex | 0.1.0 | Local browser dashboard scoped to the current task | [Codex plugin](codex/README.md) |

Both versions support researched quality metrics, required deliverables, dependency-aware phases, deadlines in Beijing time (`+08:00`), resource snapshots, retries, and protected history. Keep plans minimal: additional reports, hashes, reproduction packages, and ablations are required only when the task actually needs them.

## Repository layout

```text
ProgressTarget/
├── README.md           # English overview
├── README.zh-CN.md     # Chinese overview
├── LICENSE
├── dsh/                # DSH plugin, documentation, and tests
└── codex/              # Codex plugin, dashboard, documentation, and tests
```

The two implementations share a project and design principles, but have separate host integrations, versions, dependencies, and runtime data. Installing one does not install the other.

## Install DSH

Clone this repository, then add the **`dsh` subdirectory** to the profile that owns your DSH Web interface:

```sh
git clone https://github.com/02TJS/ProgressTarget.git
cd ProgressTarget
dsh plugin --profile <your-profile> add ./dsh
```

Restart your existing DSH Web Host. The repository root is no longer a DSH Profile Bundle. See the [DSH guide](dsh/GUIDE.zh-CN.md) and [configuration](dsh/CONFIGURATION.md).

## Install Codex

Requires Node.js 22+ and a Codex CLI with `codex plugin` support. From the cloned repository:

```sh
cd codex
npm ci
npm run build
codex plugin marketplace add .
codex plugin add progress-target@progress-target
```

On Windows, you can instead double-click `codex/安装插件.cmd`; it builds missing runtime files and installs the local plugin. Use a new Codex task after installation so the new tools and skill load.

The marketplace is inside `codex/.agents/`. Run installation from `codex/`; do not register the repository root as the Codex marketplace. Configuration is generated for your checkout location. After moving it, run the installer again.

## Plan, execute, and view progress

For Codex, say:

```text
Use the installed progress-target:progress-target skill to create a plan for [task]
in this Codex conversation. Read its SKILL.md and the GUIDE.md linked from it.
Save the plan with all phases pending and execution paused. Do not execute yet.
Return this conversation's dashboard link.
```

When ready, say “Start executing the current ProgressTarget plan.” To check progress, say “Show this conversation's ProgressTarget dashboard.” Planning and execution stay in the same conversation; a new or forked conversation starts with its own empty plan scope. Full [Codex workflow](codex/docs/usage.md) and [DSH prompts](dsh/PROMPT.zh-CN.md) are platform-specific.

Codex uses a local read-only webpage. Its optional SessionStart, Stop, and Interrupt hooks require host trust; installation alone does not activate them. Real host event dispatch remains to be validated after trust. Neither plugin provides an experiment executor or background scheduler. See the [feature comparison and limits](codex/docs/feature-audit.md).

## Development

Run `npm test` in `dsh/`. In `codex/`, run `npm ci`, `npm run build`, then `npm test`. Each directory contains its own development and packaging instructions. Runtime plans, machine-specific configuration, dependencies, and local verification output are excluded from Git and public packages.

MIT © 2026 02TJS. See [LICENSE](LICENSE); bundled Codex dependencies carry their own [notices](codex/plugins/progress-target/THIRD-PARTY-NOTICES.md).
