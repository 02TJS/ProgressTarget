import { beijingIso } from '../plugins/progress-target/core/contract.js';
export const baselineTime = Date.parse('2026-09-05T12:00:00+08:00');
export const iso = value => beijingIso(value);
export function execution(at, overrides = {}) {
  return { estimatedMinutes: 20, parallelizable: false, shardable: false, serialReason: '阶段按约定顺序验证', resourceDiscovery: { queriedAt: iso(at), servers: [] }, resources: [{ id: 'local', work: '完成阶段验收', resource: 'CPU', expectedDeliverable: '可验收交付物', status: 'planned' }], ...overrides };
}
export function phase(id, at = baselineTime, overrides = {}) {
  return {
    id, actionTitle: '验证 ' + id, what: '完成约定的阶段工作与验收', purpose: '验证最终交付物可用性',
    status: 'pending', deadlineAt: iso(at + 3600000),
    metrics: [{ key: '验收通过率', value: 0, operator: '>=', targetValue: 100, unit: '%', kind: 'quality', measurement: '按约定验收清单逐项验证，通过项/必需项', limitations: '仅覆盖已经约定的验收场景', thresholdBasis: { type: 'requirement', evidence: '任务验收清单', reason: '约定的必需验收项应全部通过' } }],
    deliverables: [{ name: '交付物-' + id, required: true, acceptance: '可以被下一阶段读取和使用', status: 'pending', evidence: '' }],
    metricResearch: { questions: ['如何直接验证交付物可用性？'], sources: [{ title: '任务验收要求', location: 'fixture://acceptance', finding: '使用实际消费场景检查可用性' }], candidateMetrics: [{ key: '验收通过率', rationale: '直接覆盖约定的消费场景', measurement: '通过项/必需项', limitations: '覆盖范围由验收清单确定' }], selectedMetrics: ['验收通过率'], selectionReason: '直接衡量交付物是否满足任务的消费要求' },
    objectiveContribution: { finalObjectiveKeys: ['最终验收通过率'], mechanism: '逐阶段验证下游需要的输入及最终使用场景', evidenceLevel: 'hypothesis', impactEstimate: null, uncertainty: '无法预估对未覆盖场景的影响', validationPlan: '用最终交付物执行约定的端到端验收', riskIfMissed: '下游得到不可用输入' },
    executionPlan: execution(at), ...overrides,
  };
}
export function planArgs(workspaceRoot, at = baselineTime, count = 2) {
  return {
    title: '契约回归测试', introduction: '仅用于隔离验证的计划', workspaceRoot, threadId: 'test-thread', sessionId: 'test-session', executionState: 'active',
    finalObjective: { description: '交付可使用的成果', metrics: [{ key: '最终验收通过率', operator: '>=', targetValue: 100, unit: '%' }], deliverables: [{ name: '最终成果', acceptance: '通过所有约定的最终验收项' }] },
    timeline: Array.from({ length: count }, (_, i) => phase('phase-' + (i + 1), at)),
  };
}
export const attempt = { summary: '尚有验收项未通过', findings: '需要完成剩余交付', adjustment: '完成剩余交付物并重新验证' };
export function readyPatch(p) {
  return { metrics: [{ key: '验收通过率', value: 100 }], deliverables: [{ name: p.deliverables[0].name, status: 'ready', evidence: 'fixture://verified-output' }] };
}
