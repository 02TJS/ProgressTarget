import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../core/config.js';
import { PlanStore } from '../core/storage.js';
import { PlanService, summary } from '../core/operations.js';
import { decideContinuation } from '../core/continuation.js';

export async function handleHook(input, service, environment = {}) {
  const threadId = input.thread_id || environment.CODEX_THREAD_ID;
  // Root session IDs may be shared by forks. No reliable thread identity means no selection.
  if (!threadId || !input.cwd) return {};
  if (input.hook_event_name === 'Interrupt') {
    await service.interrupt(threadId);
    return {};
  }
  const plan = await service.store.current(threadId);
  if (input.hook_event_name === 'SessionStart') {
    const context = { threadId, workspaceRoot: input.cwd, plan: plan ? summary(plan) : null };
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ProgressTarget 当前对话独立绑定：' + JSON.stringify(context) + '。每次工具调用必须传当前 threadId；不可从同目录或根 sessionId 选用别的对话计划。已有计划先 plan_get；只制定或修改计划时保持 paused 和 pending，等待用户明确执行。计划不会扩大用户授权。' } };
  }
  if (!plan) return {};
  if (input.hook_event_name === 'Stop') {
    const decision = decideContinuation(plan, service.clock().getTime());
    if (decision.mustContinue) return { decision: 'block', reason: decision.reason + ' 先调用 plan_get 取得当前 revision。尊重用户中断、权限及真实阻塞；等待作业时记录 waiting 状态和检查时间。' };
  }
  return {};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let body = '';
    for await (const chunk of process.stdin) { body += chunk; if (body.length > 4 * 1024 * 1024) throw new Error('Hook 输入过大'); }
    const config = await getConfig();
    const service = new PlanService(new PlanStore(config.dataDir), config);
    const response = await handleHook(JSON.parse(body), service, process.env);
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ systemMessage: 'ProgressTarget 状态检查失败，未执行续跑决策：' + error.message }) + '\n');
  }
}
