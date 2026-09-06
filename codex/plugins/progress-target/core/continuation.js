import { TERMINAL } from './contract.js';

export function decideContinuation(plan, now = Date.now()) {
  const idle = { mustContinue: false, nextPhaseAllowed: false, nextPhaseId: '', requiresUserInput: false };
  if (!plan || plan.isDemo) return { ...idle, reason: '当前没有启用的执行计划' };
  const execution = plan.execution || { state: 'paused' };
  if (['paused', 'blocked', 'finished'].includes(execution.state))
    return { ...idle, reason: execution.reason || execution.state };
  if (execution.state === 'waiting') {
    if (!execution.waitingUntil || Date.parse(execution.waitingUntil) > now)
      return { ...idle, reason: '正在等待后台结果；按约定的检查时间继续', waitingUntil: execution.waitingUntil };
    return { ...idle, mustContinue: true, reason: '计划检查点已到，检查真实作业状态与交付物，再更新计划。' };
  }
  if (!plan.timeline.length) return { ...idle, reason: '计划当前没有阶段，可按用户要求制定后续阶段。' };
  const index = plan.timeline.findIndex(p => !TERMINAL.has(p.status));
  const phase = plan.timeline[index];
  const predecessors = index < 0 ? plan.timeline : plan.timeline.slice(0, index);
  if (predecessors.some(p => !p.deliverablesReady)) return { ...idle, requiresUserInput: true, reason: '历史阶段交付记录不齐备；先核实并按用户授权恢复或补录，不能绕过前序交付门。' };
  if (!phase) {
    if (plan.finalAcceptance) return { ...idle, reason: '最终验收已经记录' };
    if ((plan.schemaVersion || 1) === 1) return { ...idle, mustContinue: true, reason: 'v1 阶段已按原质量与交付门合法结束。调用 plan_manage finalize 收尾；不要求迁移或编造 v2 最终测量。' };
    return { ...idle, mustContinue: true, reason: '阶段已结束。读取真实最终指标与交付物证据，调用 plan_manage finalize 完成最终验收；阶段结束率不等于目标达成率。' };
  }
  const nextPhaseAllowed = phase.status === 'pending' && index > 0;
  if (nextPhaseAllowed) return { ...idle, mustContinue: true, phaseId: phase.id, nextPhaseAllowed: true, nextPhaseId: phase.id, reason: (predecessors.at(-1).status === 'overdue' ? '前序阶段逾期但合法交付物已齐备。' : '前序阶段已合法结束且交付物齐备。') + '立即使用该交付物，重新查询资源并启动下一阶段“' + phase.actionTitle + '”，不要等待用户审批；尊重已有暂停指令和真实阻塞。' };
  const action = execution.nextAction || phase.attempts?.at(-1)?.adjustment ||
    (phase.status === 'pending' ? '重新查询配置资源并启动第一个可执行阶段。' : '检查当前交付物和质量指标，继续完成剩余工作。');
  return { ...idle, mustContinue: true, phaseId: phase.id, reason: '继续计划“' + plan.title + '”的阶段“' + phase.actionTitle + '”：' + action };
}
