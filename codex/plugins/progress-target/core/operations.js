import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  TERMINAL, beijingIso, normalizeConfig, requiredText, uniqueItems, optionalIso, normalizeFinalObjective,
  normalizeMetric, normalizeDeliverable, computeGate, computeDeliverablesReady,
  preparePhaseUpdate, validateInitPhase, validateFreshResourceDiscovery, applyAuditSupplement,
} from './contract.js';
import { PlanError, validId } from './storage.js';

function uniquePhases(phases) {
  if (!Array.isArray(phases) || !phases.length) throw new PlanError('INVALID_PLAN', '计划至少需要一个阶段');
  const ids = phases.map(p => requiredText(p.id, '阶段 id'));
  if (new Set(ids).size !== phases.length) throw new PlanError('DUPLICATE_PHASE', '阶段 ID 不能重复');
}
function mergeByKey(existing, changes, key, allowNew = false) {
  if (!Array.isArray(changes)) throw new PlanError('INVALID_PATCH', '更新必须是数组');
  changes = changes.map(p => ({ ...p, [key]: requiredText(p?.[key], '更新项目 ' + key) }));
  if (new Set(changes.map(p => p[key])).size !== changes.length) throw new PlanError('INVALID_PATCH', '更新中存在重复项目');
  const updates = new Map(changes.map(p => [p[key], p]));
  const unknown = changes.filter(p => !existing.some(old => old[key] === p[key]));
  if (unknown.length && !allowNew) throw new PlanError('UNKNOWN_ITEM', '请更新已规划的指标或交付物：' + unknown.map(p => p[key]).join(', '));
  return [...existing.map(old => ({ ...old, ...(updates.get(old[key]) || {}) })), ...unknown];
}
function resetAcceptance(plan) {
  if (plan.finalAcceptance) plan.finalAcceptanceHistory = [...(plan.finalAcceptanceHistory || []), structuredClone(plan.finalAcceptance)];
  plan.finalAcceptance = null;
}
function migrationItems(oldItems, proposed, key, preservedFields) {
  for (const old of oldItems || []) if (!proposed.some(item => item[key] === old[key]))
    throw new PlanError('HISTORY_PROTECTED', '迁移不能移除原有指标或交付物：' + old[key]);
  return proposed.map(item => {
    const old = oldItems?.find(previous => previous[key] === item[key]);
    if (!old) return item;
    const next = { ...item };
    for (const field of preservedFields) if (old[field] !== undefined) next[field] = structuredClone(old[field]);
    return next;
  });
}
function event(plan, type, message, at, phaseId = null) {
  plan.updatedAt = at;
  plan.events = [...(plan.events || []), { id: randomUUID(), at, type, message, phaseId }];
}
function authorized(args) {
  if (args.userAuthorized !== true) throw new PlanError('AUTHORIZATION_REQUIRED', '此操作需要真实用户授权，并填写 userAuthorized 和 reason');
  return requiredText(args.reason, 'reason');
}

export function summary(plan) {
  const phases = plan.timeline || [];
  const closed = phases.filter(p => TERMINAL.has(p.status)).length;
  return {
    id: plan.id, title: plan.title, schemaVersion: plan.schemaVersion || 1, revision: plan.revision,
    workspaceRoot: plan.workspaceRoot, ownerThreadId: plan.ownerThreadId || null, isDemo: !!plan.isDemo, createdAt: plan.createdAt, updatedAt: plan.updatedAt,
    execution: plan.execution, finalAcceptance: plan.finalAcceptance,
    total: phases.length, closed, completed: phases.filter(p => p.status === 'completed').length,
    overdue: phases.filter(p => p.status === 'overdue').length,
    qualityPassed: phases.filter(p => p.gatePassed).length,
    progress: phases.length ? Math.round(closed / phases.length * 100) : 0,
    currentPhase: phases.find(p => p.status === 'in-progress')?.id || phases.find(p => p.status === 'pending')?.id || null,
  };
}

export class PlanService {
  constructor(store, config = {}, clock = () => new Date()) { this.store = store; this.settings = normalizeConfig(config); this.clock = clock; }
  now() { return beijingIso(this.clock()); }
  async interrupt(threadId) {
    return this.store.lock('thread-' + validId(threadId), async () => {
      const current = await this.store.current(threadId);
      if (!current) return null;
      // Apply host interruptions to the latest state under the write lock, without
      // discarding an intervening phase update or reopening completed acceptance.
      return this.store.updateLatest(current.id, plan => {
        if (plan.ownerThreadId !== threadId) throw new PlanError('THREAD_MISMATCH', '计划不属于当前 Codex 对话');
        if (plan.isDemo || ['paused', 'finished'].includes(plan.execution.state)) return null;
        plan.execution = { state: 'paused', reason: '用户中断了执行；等待明确恢复', nextAction: '', waitingUntil: null };
        event(plan, 'interrupted', plan.execution.reason, this.now());
        return plan;
      });
    });
  }
  async create(args) {
    if (args.threadId && !args.scopedLockHeld) return this.store.lock('thread-' + validId(args.threadId), async () => {
      const current = await this.store.current(args.threadId);
      if (current && current.execution.state !== 'finished') throw new PlanError('CURRENT_PLAN_EXISTS', '当前对话已有未收尾计划；请修改现有计划，不要重复新建');
      return this.create({ ...args, scopedLockHeld: true });
    });
    const at = this.now();
    const executionState = args.executionState || 'paused';
    if (!['paused', 'active'].includes(executionState)) throw new PlanError('INVALID_STATE', 'executionState 必须是 paused 或 active');
    uniquePhases(args.timeline);
    const finalObjective = normalizeFinalObjective(args.finalObjective);
    const timeline = args.timeline.map((p, i) => {
      if (p.status && p.status !== 'pending') throw new PlanError('INVALID_INITIAL_STATE', '新计划从 pending 开始；历史计划请导入');
      const next = validateInitPhase({ ...p, status: 'pending' }, i, at, this.settings, { schemaVersion: 2, finalObjective });
      if (!next.executionPlan.resourceDiscovery.deferred) validateFreshResourceDiscovery(next.executionPlan.resourceDiscovery, at, '', '', this.settings);
      return next;
    });
    const plan = {
      id: args.planId ? validId(args.planId) : randomUUID(), title: requiredText(args.title, 'title'),
      schemaVersion: 2, introduction: requiredText(args.introduction, 'introduction'),
      finalObjective, timeline, workspaceRoot: resolve(requiredText(args.workspaceRoot, 'workspaceRoot')),
      ownerThreadId: args.threadId || null, ownerSessionId: args.sessionId || null, isDemo: false, createdAt: at, updatedAt: at, events: [],
      execution: { state: executionState, reason: executionState === 'paused' ? '计划已制定，等待用户明确开始执行' : '', nextAction: '', waitingUntil: null },
      finalAcceptance: null,
    };
    event(plan, 'plan-created', '建立 v2 计划', at);
    const saved = await this.store.create(plan);
    if (args.sessionId) await this.store.bind(saved, args.sessionId, args.workspaceRoot);
    if (args.threadId) await this.store.bindThread(saved, args.threadId);
    return saved;
  }
  async updatePhase(args) {
    const at = this.now();
    return this.store.update(args.planId, args.expectedRevision, plan => {
      const index = plan.timeline.findIndex(p => p.id === args.phaseId);
      if (index < 0) throw new PlanError('UNKNOWN_PHASE', '阶段不存在，请先规划该阶段');
      const old = plan.timeline[index];
      const patch = { ...args.patch };
      if (args.threadId && plan.ownerThreadId !== args.threadId) throw new PlanError('THREAD_MISMATCH', '计划不属于当前 Codex 对话');
      const planningOnly = old.status === 'pending' && (!patch.status || patch.status === 'pending');
      if (plan.execution.state === 'finished' || (['paused', 'blocked'].includes(plan.execution.state) && !planningOnly)) throw new PlanError('PLAN_NOT_ACTIVE', '请先明确恢复计划，再开始执行阶段');
      if (patch.metrics !== undefined) {
        patch.metrics = mergeByKey(old.metrics || [], patch.metrics, 'key', (plan.schemaVersion || 1) === 1);
        if (old.status !== 'pending' && patch.metrics.some(m => { const previous = old.metrics?.find(item => item.key === m.key); return previous && (m.targetValue !== previous.targetValue || m.operator !== previous.operator); }))
          throw new PlanError('THRESHOLD_FROZEN', '阶段启动后不能通过修改阈值使指标达标');
      }
      if (patch.deliverables !== undefined) {
        patch.deliverables = mergeByKey(old.deliverables || [], patch.deliverables, 'name', (plan.schemaVersion || 1) === 1);
        if (patch.deliverables.some(d => { const previous = old.deliverables?.find(item => item.name === d.name); return previous && previous.required !== false && d.required === false; }))
          throw new PlanError('DELIVERABLE_REQUIRED', '不能把必需交付物改成可选以跳过验收');
      }
      const status = patch.status || old.status;
      if (status === 'in-progress') {
        const blocked = plan.timeline.slice(0, index).find(p => !TERMINAL.has(p.status) || !p.deliverablesReady);
        if (blocked) throw new PlanError('PREDECESSOR_BLOCKED', '前序阶段尚未合法结束或交付物缺失：' + blocked.id);
      }
      const next = preparePhaseUpdate(old, patch, at, this.settings, {
        schemaVersion: plan.schemaVersion || 1, finalObjective: plan.finalObjective,
        previousPhaseCompletedAt: index > 0 ? plan.timeline[index - 1].completedAt : '',
      });
      if (old.status !== 'pending') {
        const frozen = ['operator', 'targetValue', 'unit', 'kind', 'measurement', 'thresholdBasis'];
        if (next.metrics.some(m => { const previous = old.metrics?.find(item => item.key === m.key); return previous && frozen.some(key => JSON.stringify(m[key]) !== JSON.stringify(previous[key])); }))
          throw new PlanError('MEASUREMENT_FROZEN', '阶段启动后不能改写指标的单位、测量方法、类型或阈值依据');
        if (next.deliverables.some(d => { const previous = old.deliverables?.find(item => item.name === d.name); return previous && previous.acceptance !== d.acceptance; }))
          throw new PlanError('ACCEPTANCE_FROZEN', '阶段启动后不能改写既有交付物的验收条件');
      }
      if (!next.metrics.length || !next.deliverables.some(d => d.required !== false)) throw new PlanError('INVALID_CONTRACT', '阶段必须保留指标和必需交付物');
      plan.timeline[index] = next;
      if (!planningOnly) plan.execution = { state: 'active', reason: '', nextAction: '', waitingUntil: null };
      event(plan, 'phase-updated', next.actionTitle + ' · ' + next.status, at, next.id);
      return plan;
    });
  }
  async manage(args) {
    const at = this.now();
    if (args.threadId && !['import-plan', 'bind'].includes(args.operation)) await this.store.forThread(args.threadId, args.planId);
    if (args.operation === 'delete-plan') {
      const reason = authorized(args);
      await this.store.remove(args.planId, args.expectedRevision, { at, planId: args.planId, reason, operation: args.operation });
      return { deleted: true, planId: args.planId };
    }
    if (args.operation === 'bind') {
      if (args.threadId && !args.scopedLockHeld) return this.store.lock('thread-' + validId(args.threadId), async () => {
        const current = await this.store.current(args.threadId);
        if (current && current.id !== args.planId && current.execution.state !== 'finished') throw new PlanError('CURRENT_PLAN_EXISTS', '不能覆盖当前对话尚未收尾的计划绑定');
        return this.manage({ ...args, scopedLockHeld: true });
      });
      let plan = await this.store.read(args.planId);
      if (args.threadId) {
        if (plan.ownerThreadId && plan.ownerThreadId !== args.threadId) throw new PlanError('THREAD_MISMATCH', '不能把其他对话的计划绑定到当前对话；需要复制导入');
        if (!plan.ownerThreadId) {
          authorized(args);
          plan = await this.store.update(plan.id, args.expectedRevision, p => { p.ownerThreadId = validId(args.threadId); event(p, 'thread-bound', args.reason, at); return p; });
        }
        await this.store.bindThread(plan, args.threadId);
        return plan;
      }
      if (resolve(args.workspaceRoot) !== plan.workspaceRoot) authorized(args);
      await this.store.bind(plan, requiredText(args.sessionId, 'sessionId'), requiredText(args.workspaceRoot, 'workspaceRoot'));
      return plan;
    }
    if (args.operation === 'import-plan') return this.importPlan(args);
    return this.store.update(args.planId, args.expectedRevision, plan => {
      if (args.threadId && plan.ownerThreadId !== args.threadId) throw new PlanError('THREAD_MISMATCH', '计划不属于当前 Codex 对话');
      if (args.operation === 'revise-plan') {
        const schemaVersion = plan.schemaVersion || 1;
        if (schemaVersion === 1 && args.finalObjective) throw new PlanError('EXPLICIT_MIGRATION_REQUIRED', '为旧计划增加 v2 最终目标请显式使用 migrate-plan');
        if (plan.execution.state === 'finished' && !args.timeline?.length) throw new PlanError('FINISHED', '已收尾计划的验收结果受保护；新增必要的后续阶段后再修订');
        const history = plan.timeline.filter(p => p.status !== 'pending');
        const objective = args.finalObjective ? normalizeFinalObjective(args.finalObjective) : plan.finalObjective;
        if (history.length && JSON.stringify(objective) !== JSON.stringify(plan.finalObjective)) throw new PlanError('OBJECTIVE_FROZEN', '已有执行历史时保留最终目标；不能通过修改目标使历史达标');
        const pending = args.timeline || plan.timeline.filter(p => p.status === 'pending');
        if (!Array.isArray(pending)) throw new PlanError('INVALID_PLAN', 'timeline 必须是未开始阶段数组');
        const protectedIds = new Set(history.map(p => p.id));
        if (pending.some(p => protectedIds.has(p.id) || (p.status && p.status !== 'pending'))) throw new PlanError('HISTORY_PROTECTED', 'revise-plan 仅接收 pending 阶段，执行历史会自动保留');
        const removed = plan.timeline.filter(p => p.status === 'pending' && !pending.some(next => next.id === p.id));
        if (removed.length) {
          const reason = authorized(args);
          plan.deletionAudit = [...(plan.deletionAudit || []), ...removed.map(p => ({ at, phaseId: p.id, reason }))];
        }
        const checked = pending.map((p, i) => {
          const source = { ...p, status: 'pending' }; delete source.startedAt; delete source.completedAt;
          const next = validateInitPhase(source, history.length + i, at, this.settings, { schemaVersion, finalObjective: objective });
          const previous = plan.timeline.find(old => old.id === p.id);
          if (previous) next.createdAt = previous.createdAt;
          return next;
        });
        uniquePhases([...history, ...checked]);
        plan.timeline = [...history, ...checked]; plan.finalObjective = objective;
        if (args.title !== undefined) plan.title = requiredText(args.title, 'title');
        if (args.introduction !== undefined) plan.introduction = requiredText(args.introduction, 'introduction');
        resetAcceptance(plan);
        plan.execution = { state: 'paused', reason: '计划修改已保存，等待用户明确开始执行', nextAction: '', waitingUntil: null };
      } else if (args.operation === 'set-execution') {
        const state = args.state;
        if (!['active', 'waiting', 'paused', 'blocked'].includes(state)) throw new PlanError('INVALID_STATE', '无效的执行状态');
        if (plan.execution.state === 'finished') throw new PlanError('FINISHED', '已经收尾的计划请追加纠正阶段后恢复');
        plan.execution = {
          state, reason: state === 'active' ? (args.reason || '') : requiredText(args.reason, 'reason'),
          nextAction: args.nextAction || '', waitingUntil: state === 'waiting' ? optionalIso(args.waitingUntil, 'waitingUntil') || null : null,
        };
      } else if (args.operation === 'delete-phase') {
        const reason = authorized(args);
        const index = plan.timeline.findIndex(p => p.id === args.phaseId);
        if (index < 0) throw new PlanError('UNKNOWN_PHASE', '阶段不存在');
        plan.timeline.splice(index, 1);
        plan.deletionAudit = [...(plan.deletionAudit || []), { at, phaseId: args.phaseId, reason }];
      } else if (args.operation === 'audit-phase') {
        authorized(args);
        const index = plan.timeline.findIndex(p => p.id === args.phaseId);
        if (index < 0) throw new PlanError('UNKNOWN_PHASE', '阶段不存在');
        plan.timeline[index] = applyAuditSupplement(plan.timeline[index], { ...args.supplement, reason: args.reason }, at, this.settings, { schemaVersion: plan.schemaVersion || 1 });
      } else if (args.operation === 'append-phase') {
        const next = validateInitPhase({ ...args.phase, status: 'pending' }, plan.timeline.length, at, this.settings, { schemaVersion: plan.schemaVersion || 1, finalObjective: plan.finalObjective });
        uniquePhases([...plan.timeline, next]);
        plan.timeline.push(next);
        resetAcceptance(plan);
        if (plan.execution.state === 'finished') plan.execution = { state: 'paused', reason: '已追加新阶段，等待明确执行', nextAction: '', waitingUntil: null };
      } else if (args.operation === 'migrate-plan') {
        authorized(args);
        if ((plan.schemaVersion || 1) !== 1) throw new PlanError('ALREADY_V2', '仅 v1 计划需要迁移');
        uniquePhases(args.timeline);
        if (args.timeline.length !== plan.timeline.length) throw new PlanError('MIGRATION_PHASE_MISMATCH', '迁移不能增删阶段');
        const finalObjective = normalizeFinalObjective(args.finalObjective);
        const byId = new Map(args.timeline.map(p => [p.id, p]));
        plan.timeline = plan.timeline.map((old, i) => {
          const supplement = byId.get(old.id);
          if (!supplement) throw new PlanError('MIGRATION_PHASE_MISMATCH', '迁移缺少阶段：' + old.id);
          const contract = { ...old, ...supplement, status: 'pending' };
          contract.metrics = migrationItems(old.metrics, contract.metrics || [], 'key', ['value', 'operator', 'targetValue', 'unit']);
          contract.deliverables = migrationItems(old.deliverables, contract.deliverables || [], 'name', ['required', 'acceptance', 'status', 'evidence']);
          delete contract.startedAt; delete contract.completedAt;
          const checked = { ...structuredClone(old), ...validateInitPhase(contract, i, at, { ...this.settings, requiredServers: [] }, { schemaVersion: 2, finalObjective, historical: true }) };
          // Schema validation must never run a historical runtime transition.
          for (const key of ['status', 'createdAt', 'startedAt', 'deadlineAt', 'completedAt', 'progress', 'overdue', 'attempts', 'result', 'resourceDiscoveryHistory', 'auditSupplements', 'deadlineHistory'])
            if (old[key] !== undefined) checked[key] = structuredClone(old[key]);
          if (old.executionPlan) checked.executionPlan = structuredClone(old.executionPlan);
          if (TERMINAL.has(old.status)) for (const key of ['pLabel', 'actionTitle', 'timeline', 'what', 'purpose']) if (old[key]) checked[key] = old[key];
          checked.gatePassed = computeGate(checked.metrics);
          checked.deliverablesReady = computeDeliverablesReady(checked.deliverables);
          checked.deadlineBreached = old.deadlineBreached ?? !!(checked.deadlineAt && Date.parse(checked.completedAt || at) > Date.parse(checked.deadlineAt));
          return checked;
        });
        plan.schemaVersion = 2; plan.finalObjective = finalObjective;
        plan.migrations = [...(plan.migrations || []), { at, from: 1, to: 2, reason: args.reason, previousExecution: structuredClone(plan.execution) }];
        plan.execution = { state: 'paused', reason: 'v2 契约迁移完成，等待明确恢复或提交最终实测验收', nextAction: '', waitingUntil: null };
      } else if (args.operation === 'finalize') {
        if (plan.execution.state === 'finished') throw new PlanError('FINISHED', '最终验收已记录，不能直接覆盖；如需纠正请追加必要阶段');
        if (!plan.timeline.length || plan.timeline.some(p => !TERMINAL.has(p.status) || !p.deliverablesReady))
          throw new PlanError('UNFINISHED_PHASES', '必须先合法结束所有阶段并交付必需产物');
        if ((plan.schemaVersion || 1) === 1) {
          plan.execution = { state: 'finished', reason: 'v1 阶段已按原门控收尾；未声明 v2 最终目标验收', nextAction: '', waitingUntil: null };
          plan.finalAcceptance = null;
          event(plan, args.operation, plan.execution.reason, at);
          return plan;
        }
        if (!plan.finalObjective) throw new PlanError('FINAL_OBJECTIVE_REQUIRED', '请先迁移到具有最终目标的 v2 计划');
        for (const [field, key] of [['metrics', 'key'], ['deliverables', 'name']]) {
          const values = args[field] || [];
          if (!Array.isArray(values)) throw new PlanError('INVALID_PATCH', field + ' 必须是数组');
          uniqueItems(values, key, '最终验收 ' + field);
          if (values.some(value => !plan.finalObjective[field].some(target => target[key] === value[key])))
            throw new PlanError('UNKNOWN_ITEM', '最终验收只能提交已约定的指标和交付物');
        }
        const metrics = plan.finalObjective.metrics.map(target => {
          const measured = args.metrics?.find(m => m.key === target.key);
          if (!measured || typeof measured.value !== 'number' || !Number.isFinite(measured.value)) throw new PlanError('FINAL_MEASUREMENT_REQUIRED', '缺少最终实测指标：' + target.key);
          return { ...target, value: measured.value, evidence: requiredText(measured.evidence, '最终指标 evidence') };
        });
        const deliverables = plan.finalObjective.deliverables.map(target => {
          const measured = args.deliverables?.find(d => d.name === target.name);
          return { ...target, evidence: requiredText(measured?.evidence, '最终交付物 evidence') };
        });
        const met = computeGate(metrics);
        if (!met && !plan.timeline.some(p => p.status === 'overdue')) throw new PlanError('FINAL_GATE_FAILED', '最终目标未达成，请追加纠正阶段');
        if (!met) requiredText(args.reason, '部分交付原因');
        plan.finalAcceptance = { at, met, outcome: met ? 'fulfilled' : 'shortfall', metrics, deliverables, reason: args.reason || '' };
        plan.execution = { state: 'finished', reason: args.reason || '', nextAction: '', waitingUntil: null };
      } else throw new PlanError('UNKNOWN_OPERATION', '不支持的管理操作');
      event(plan, args.operation, args.reason || args.operation, at, args.phaseId || null);
      return plan;
    });
  }
  async importPlan(args) {
    authorized(args);
    if (args.threadId && !args.scopedLockHeld) return this.store.lock('thread-' + validId(args.threadId), async () => {
      const current = await this.store.current(args.threadId);
      if (current && current.execution.state !== 'finished') throw new PlanError('CURRENT_PLAN_EXISTS', '当前对话已有未收尾计划；请先处理现有计划');
      return this.importPlan({ ...args, scopedLockHeld: true });
    });
    const original = args.plan;
    uniquePhases(original?.timeline);
    const schemaVersion = original.schemaVersion || 1;
    if (![1, 2].includes(schemaVersion)) throw new PlanError('UNSUPPORTED_SCHEMA', '仅支持 v1/v2 计划');
    const at = this.now();
    const finalObjective = schemaVersion === 2 ? normalizeFinalObjective(original.finalObjective) : null;
    const timeline = original.timeline.map((p, i) => {
      if (!['pending', 'in-progress', 'completed', 'overdue'].includes(p.status)) throw new PlanError('INVALID_STATE', '历史阶段状态无效');
      let normalized = {};
      if (schemaVersion === 2) {
        const contract = { ...p, status: 'pending' };
        delete contract.startedAt; delete contract.completedAt;
        normalized = validateInitPhase(contract, i, at, { ...this.settings, requiredServers: [] }, { schemaVersion, finalObjective, historical: true });
        for (const key of ['createdAt', 'startedAt', 'deadlineAt', 'completedAt']) if (p[key]) optionalIso(p[key], key);
        // Keep actual historical checkpoints instead of regenerating an initial schedule.
        for (const key of ['checkpointMode', 'checkpoints', 'harvestAtMinutes']) if (p.executionPlan?.[key] !== undefined)
          normalized.executionPlan[key] = structuredClone(p.executionPlan[key]);
      }
      const metrics = (p.metrics || []).map(m => normalizeMetric(m, { v2: schemaVersion === 2 }));
      const deliverables = (p.deliverables || []).map(normalizeDeliverable);
      uniqueItems(metrics, 'key', 'metrics'); uniqueItems(deliverables, 'name', 'deliverables');
      const next = { ...structuredClone(p), ...normalized, metrics, deliverables, gatePassed: computeGate(metrics), deliverablesReady: computeDeliverablesReady(deliverables) };
      for (const key of ['status', 'createdAt', 'startedAt', 'deadlineAt', 'completedAt', 'progress', 'overdue', 'attempts', 'result', 'resourceDiscoveryHistory', 'auditSupplements', 'deadlineHistory'])
        if (p[key] !== undefined) next[key] = structuredClone(p[key]);
      return next;
    });
    const plan = {
      ...structuredClone(original), id: randomUUID(), title: args.title || original.title || '导入的 DSH 计划',
      schemaVersion, timeline, ...(finalObjective ? { finalObjective } : {}),
      workspaceRoot: resolve(requiredText(args.workspaceRoot, 'workspaceRoot')), ownerThreadId: args.threadId || null, ownerSessionId: args.sessionId || null,
      originSessionId: args.originSessionId || original.sessionId || null,
      createdAt: original.createdAt || at, updatedAt: at, isDemo: false, finalAcceptance: null,
      finalAcceptanceHistory: [...(original.finalAcceptanceHistory || []), ...(original.finalAcceptance ? [structuredClone(original.finalAcceptance)] : [])],
      execution: { state: 'paused', reason: '历史计划已导入；确认后可恢复', nextAction: '', waitingUntil: null },
      events: structuredClone(original.events || []),
    };
    event(plan, 'plan-imported', args.reason, at);
    const saved = await this.store.create(plan);
    if (args.sessionId) await this.store.bind(saved, args.sessionId, args.workspaceRoot);
    if (args.threadId) await this.store.bindThread(saved, args.threadId);
    return saved;
  }
}
