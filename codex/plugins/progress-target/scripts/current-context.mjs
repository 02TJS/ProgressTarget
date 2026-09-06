// Run inside the calling Codex task's shell, never inside the shared MCP server.
const threadId = process.env.CODEX_THREAD_ID;
if (!threadId) {
  console.error('缺少当前 Codex 对话身份 CODEX_THREAD_ID；停止选择或创建计划，不使用目录、进程号或根 sessionId 代替。');
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ threadId, workspaceRoot: process.cwd() }) + '\n');
}
