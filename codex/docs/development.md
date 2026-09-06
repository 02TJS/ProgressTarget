# 开发与维护

在仓库的 `codex/` 目录工作。DSH 的代码、版本和测试位于相邻的 `dsh/`，两端分别构建和安装。

## 构建与配置

```sh
npm ci
npm run build
npm test
```

构建将 MCP SDK 与运行代码打入 `plugins/progress-target/dist/` 的三个独立文件，并生成第三方许可说明。运行这些文件只需要 Node.js 22+。源码、开发依赖和测试通过 `package-lock.json` 管理。

`scripts/configure.mjs` 按当前目录生成 `.mcp.json`、`hooks/hooks.json` 和 `local-config.json`，让 Codex 缓存中的插件仍访问这一份运行包和数据。生成的本机路径不提交到 Git，也不放进发布 ZIP；源码安装需要先构建，发布包的安装或看板入口会重新生成配置。

端口、固定资源清单和资源快照有效期可在 `plugins/progress-target/local-config.json` 中调整。`requiredServers` 默认空列表。配置固定服务器后，代理必须提供覆盖这些服务器的真实资源记录。

## 插件安装与更新

市场文件位于本目录 `.agents/plugins/marketplace.json`，名称为 `progress-target`。首次安装先运行 `codex plugin marketplace add .` 注册这一明确指定的本地市场，再运行 `codex plugin add progress-target@progress-target`。Windows 的 `安装插件.cmd` 合并了构建、配置和注册安装步骤。

修改代码后重建并运行受影响的验证。更新已安装版本时，按 Codex 的插件开发工具刷新缓存版本并重新安装，在新任务中检查 Skill 和 MCP 工具。停止并重启受影响的看板或 MCP 进程，避免继续使用旧进程。

移动目录时先停止看板，把整个目录移到目标位置，再运行配置和安装入口。历史证据中的原始路径不会被自动改写。

## 验证

```sh
node scripts/verify-ui.mjs
```

浏览器验证自行建立隔离服务和合成计划，覆盖 22 项交互、显示、对话归属、SSE 和断线恢复检查；结束后关闭测试服务。需要本机 Chrome，或设置 `PT_BROWSER_CHANNEL=msedge`。无需任何真实 Codex 对话计划。

Windows 启停入口检查：

```sh
node scripts/verify-launchers.mjs
```

它检查 PowerShell 语法、启动、重复启动复用和服务身份，结束后停止本目录的看板。验证输出统一位于忽略的 `qa/`，测试数据位于 `qa/test-runs/`。

核心和 stdio 子进程测试不能代替宿主 Hook 事件验收。只读的 `scripts/inspect-host-hooks.mjs <实际桌面 codex.exe 路径>` 可以查看识别和信任状态；它不触发模型或修改信任。自动 Hook 需用户在宿主中审阅信任后再验证。

## 发布包

```sh
npm run build
npm run package
node scripts/verify-package.mjs
node scripts/verify-install.mjs
```

打包需要 Python 3，最后两条验证需要 Windows。输出是 `dist/ProgressTarget-Codex-0.1.0.zip`，包含源码、文档、测试、已构建运行包和安装入口。显式排除运行计划、QA 记录、依赖缓存和本机配置。解压后第一次安装或启动会按新位置生成配置。安装验证使用 `qa/test-runs/` 下的独立 Codex 数据目录，不修改正在使用的插件，也不运行模型或开启 Hook 信任。

`npm run demo` 只创建标记为 `isDemo` 的合成演示计划，不创建开发验收计划，不改写示例或指南。发布包默认没有计划；体验演示需要使用者主动运行此命令。

## 计划与宿主边界

MCP 每次调用均使用实际调用方的 `CODEX_THREAD_ID`，不以共享服务进程、根 session 或工作目录确定归属。每次写入检查最新 revision；存储使用锁和原子替换。新建和修订默认暂停，执行前才提交真实资源快照。

导入、迁移、删除和终态补录需要真实用户授权；工具的布尔参数不构成授权本身。`waitingUntil` 是计划记录，不会自行唤醒模型。完整行为见 [GUIDE](../plugins/progress-target/GUIDE.md)、[使用流程](usage.md)与[功能对照](feature-audit.md)。
