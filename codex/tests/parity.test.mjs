import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService } from '../plugins/progress-target/core/operations.js';
import { decideContinuation } from '../plugins/progress-target/core/continuation.js';
import { computeGate, normalizeConfig, normalizeExecutionPlan, validateFreshResourceDiscovery } from '../plugins/progress-target/core/contract.js';
import { baselineTime, phase, planArgs, execution, iso, attempt, readyPatch } from './fixtures.mjs';

async function env(config = {}) {
  const parent = resolve('qa/test-runs'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'parity-'));
  const store = new PlanStore(join(root, 'data')); let now = baselineTime;
  return { root, store, service: new PlanService(store, config, () => new Date(now)), now: () => now, tick: (ms = 1000) => now += ms };
}
function legacyPhase(id, overrides = {}) {
  const p = phase(id);
  delete p.metricResearch; delete p.objectiveContribution;
  p.metrics = p.metrics.map(({ key, value, operator, targetValue, unit }) => ({ key, value, operator, targetValue, unit }));
  return { createdAt: iso(baselineTime - 3600000), ...p, ...overrides };
}
async function legacy(e, timeline = [legacyPhase('old')]) {
  return e.service.importPlan({ threadId: 'legacy-thread', workspaceRoot: e.root, userAuthorized: true, reason: '隔离测试原 DSH v1 兼容行为', plan: { introduction: '旧计划完整说明', timeline } });
}
const manage = (e, p, operation, rest = {}) => e.service.manage({ threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, operation, ...rest });
const update = (e, p, patch, phaseId = p.timeline[0].id) => e.service.updatePhase({ threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, phaseId, patch });

test('v1 can fill missing planned metrics and deliverables without converting schema', async () => {
  const e = await env(); let p = await legacy(e, [legacyPhase('old', { metrics: [], deliverables: [] })]);
  const before = await readFile(e.store.path(p.id), 'utf8');
  await e.store.forThread('legacy-thread', p.id);
  assert.equal(await readFile(e.store.path(p.id), 'utf8'), before);
  const complete = legacyPhase('old');
  p = await update(e, p, { metrics: complete.metrics, deliverables: complete.deliverables });
  assert.equal(p.schemaVersion, 1); assert.equal(p.timeline[0].metrics.length, 1);
  assert.equal(p.execution.state, 'paused');
});

test('v1 can revise pending contracts and append stages while preserving history', async () => {
  const e = await env(); let p = await legacy(e);
  const originalCreatedAt = p.timeline[0].createdAt;
  p = await manage(e, p, 'revise-plan', { timeline: [legacyPhase('old', { actionTitle: '修订后的旧阶段' })] });
  p = await manage(e, p, 'append-phase', { phase: legacyPhase('next') });
  assert.equal(p.schemaVersion, 1); assert.equal(p.finalObjective, undefined);
  assert.deepEqual(p.timeline.map(x => x.id), ['old', 'next']);
  assert.equal(p.timeline[0].createdAt, originalCreatedAt);
  assert.equal(p.execution.state, 'paused');
});

test('v1 completes under legacy gates without being forced to migrate or invent final measurements', async () => {
  const e = await env(); let p = await legacy(e);
  p = await manage(e, p, 'set-execution', { state: 'active' });
  p = await update(e, p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt });
  p = await update(e, p, { status: 'completed', ...readyPatch(p.timeline[0]) });
  assert.match(decideContinuation(p, e.now()).reason, /v1/);
  p = await manage(e, p, 'finalize');
  assert.equal(p.schemaVersion, 1); assert.equal(p.execution.state, 'finished');
  assert.equal(p.finalAcceptance, null);
  assert.equal(decideContinuation(p, e.now()).mustContinue, false);
  const next = await e.service.create({ ...planArgs(e.root, e.now(), 1), threadId: 'legacy-thread', executionState: 'paused' });
  assert.notEqual(next.id, p.id);
});

test('migration preserves historical measurements, deliverables, audit records and actual execution schedule', async () => {
  const e = await env();
  const old = legacyPhase('old', {
    status: 'completed', startedAt: iso(e.now() - 600000), completedAt: iso(e.now() - 1000),
    metrics: [{ key: '验收通过率', value: 100, operator: '>=', targetValue: 100, unit: '%' }],
    deliverables: [{ name: '交付物-old', required: true, acceptance: '历史消费条件', status: 'ready', evidence: 'archive://actual-output' }],
    auditSupplements: [{ at: iso(e.now() - 1000), fields: ['startedAt'], reason: '历史补录' }],
    deadlineHistory: [{ at: iso(e.now() - 2000), previous: iso(e.now() - 3000), next: iso(e.now() + 3600000), reason: '历史重估' }],
  });
  old.executionPlan.checkpointMode = 'remaining'; old.executionPlan.checkpoints = [{ kind: '50%', minutes: 5 }, { kind: '100%', minutes: 10 }];
  const p = await legacy(e, [old]);
  const supplement = phase('old'); supplement.metrics[0].value = 1; supplement.metrics[0].targetValue = 10;
  supplement.deliverables[0].evidence = 'incorrect://replacement';
  const next = await manage(e, p, 'migrate-plan', { userAuthorized: true, reason: '补充 v2 契约', finalObjective: planArgs(e.root).finalObjective, timeline: [supplement] });
  const actual = next.timeline[0];
  assert.equal(actual.metrics[0].value, 100); assert.equal(actual.metrics[0].targetValue, 100);
  for (const key of ['deliverables', 'auditSupplements', 'deadlineHistory', 'executionPlan', 'startedAt', 'completedAt']) assert.deepEqual(actual[key], p.timeline[0][key], key);
});

test('historical v2 import ignores newly configured servers until actual execution resumes', async () => {
  const e = await env({ requiredServers: ['new-gpu'] });
  const args = planArgs(e.root, baselineTime, 1);
  const p = await e.service.importPlan({ threadId: 'legacy-thread', workspaceRoot: e.root, userAuthorized: true, reason: '导入先前部署的 v2 计划', plan: { schemaVersion: 2, finalObjective: args.finalObjective, timeline: args.timeline } });
  assert.deepEqual(p.timeline[0].executionPlan.resourceDiscovery.servers, []);
  const active = await manage(e, p, 'set-execution', { state: 'active' });
  await assert.rejects(update(e, active, { status: 'in-progress', executionPlan: execution(e.tick()), attempt }), /资源发现结果不能为空/);
});

test('explicit terminal audit fills missing fields once without dropping v2 metric metadata', async () => {
  const e = await env(); let p = await e.service.create(planArgs(e.root, baselineTime, 1));
  // Represents an archived v2 record with a missing metrics field; only isolated test storage is changed.
  p = await e.store.update(p.id, p.revision, value => { value.timeline[0].status = 'completed'; value.timeline[0].metrics = []; return value; });
  const metric = phase('phase-1').metrics[0]; metric.value = 100;
  await assert.rejects(manage(e, p, 'audit-phase', { phaseId: 'phase-1', supplement: { metrics: [metric] }, reason: '缺少授权' }), /真实用户授权/);
  p = await manage(e, p, 'audit-phase', { phaseId: 'phase-1', supplement: { metrics: [metric] }, userAuthorized: true, reason: '测试明确补录' });
  assert.equal(p.timeline[0].metrics[0].kind, 'quality');
  assert.deepEqual(p.timeline[0].metrics[0].thresholdBasis, metric.thresholdBasis);
  await assert.rejects(manage(e, p, 'audit-phase', { phaseId: 'phase-1', supplement: { metrics: [metric] }, userAuthorized: true, reason: '重复覆盖' }), /不可覆盖/);
});

test('legal overdue output explicitly allows immediate downstream continuation', async () => {
  const e = await env(); let p = await e.service.create(planArgs(e.root));
  p = await update(e, p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt });
  e.tick(3600001);
  p = await update(e, p, { status: 'overdue', deliverables: readyPatch(p.timeline[0]).deliverables });
  const next = decideContinuation(p, e.now());
  assert.equal(next.mustContinue, true); assert.equal(next.nextPhaseAllowed, true); assert.equal(next.nextPhaseId, 'phase-2');
  assert.match(next.reason, /不要等待用户审批/);
  p = await manage(e, p, 'set-execution', { state: 'paused', reason: '用户暂停' });
  assert.equal(decideContinuation(p, e.now()).nextPhaseAllowed, false);
});

test('finished acceptance cannot be overwritten and remains available after adding necessary work', async () => {
  const e = await env(); let p = await e.service.create(planArgs(e.root, baselineTime, 1));
  p = await update(e, p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt });
  p = await update(e, p, { status: 'completed', ...readyPatch(p.timeline[0]) });
  const final = { metrics: [{ key: '最终验收通过率', value: 100, evidence: 'actual://measure' }], deliverables: [{ name: '最终成果', evidence: 'actual://output' }] };
  p = await manage(e, p, 'finalize', final);
  const accepted = structuredClone(p.finalAcceptance);
  const copied = await e.service.importPlan({ threadId: 'copied-thread', workspaceRoot: e.root, userAuthorized: true, reason: '导入导出的完整计划', plan: p });
  assert.deepEqual(copied.finalAcceptanceHistory.at(-1), accepted);
  assert.deepEqual(copied.events.slice(0, p.events.length), p.events);
  assert.equal(copied.execution.state, 'paused');
  await assert.rejects(manage(e, p, 'finalize', final), { code: 'FINISHED' });
  await assert.rejects(manage(e, p, 'revise-plan', { title: '无后续阶段的改写' }), { code: 'FINISHED' });
  p = await manage(e, p, 'append-phase', { phase: phase('correction') });
  assert.equal(p.finalAcceptance, null); assert.deepEqual(p.finalAcceptanceHistory.at(-1), accepted);
  assert.equal(p.execution.state, 'paused');
});

test('all five numeric comparison operators preserve boundary behavior', () => {
  for (const [operator, value, targetValue, expected] of [['>=', 1, 1, true], ['>', 1, 1, false], ['>', 2, 1, true], ['<=', 1, 1, true], ['<', 1, 1, false], ['<', 0, 1, true], ['==', 1, 1, true], ['==', 2, 1, false]]) {
    assert.equal(computeGate([{ value, operator, targetValue }]), expected);
  }
  assert.equal(computeGate([{ value: 1, operator: '>=', targetValue: 1 }, { value: 0, operator: '>=', targetValue: 1 }]), false);
});

test('resource freshness enforces age, predecessor completion, replay and parallel requirements', () => {
  const settings = normalizeConfig({}); const at = iso(baselineTime);
  assert.throws(() => validateFreshResourceDiscovery({ queriedAt: iso(baselineTime - 11 * 60000) }, at, '', '', settings), /新鲜度/);
  assert.throws(() => validateFreshResourceDiscovery({ queriedAt: at }, at, at, '', settings), /上一阶段结束之后/);
  assert.throws(() => validateFreshResourceDiscovery({ queriedAt: at }, at, '', at, settings), /晚于该阶段上一份/);
  assert.throws(() => normalizeExecutionPlan(execution(baselineTime, { estimatedMinutes: 60, serialReason: '' }), settings), /serialReason/);
  assert.throws(() => normalizeExecutionPlan(execution(baselineTime, { estimatedMinutes: 60, parallelizable: true }), settings), /至少2个/);
});

test('DSH semantic phase IDs including Chinese remain usable and duplicates are rejected', async () => {
  const e = await env(); let p = await legacy(e, [legacyPhase('数据准备')]);
  p = await manage(e, p, 'append-phase', { phase: legacyPhase('结果验收') });
  assert.deepEqual(p.timeline.map(item => item.id), ['数据准备', '结果验收']);
  await assert.rejects(manage(e, p, 'append-phase', { phase: legacyPhase('数据准备') }), { code: 'DUPLICATE_PHASE' });
  p = await update(e, p, { result: '中文阶段 ID 可更新' }, '数据准备');
  assert.equal(p.timeline[0].result, '中文阶段 ID 可更新');
});

test('configured resource freshness is honored and invalid zero is not silently replaced by the default', async () => {
  const e = await env(); const core = join(e.root, 'plugin/core'); await mkdir(core, { recursive: true });
  await copyFile(resolve('plugins/progress-target/core/config.js'), join(core, 'config.js'));
  const configPath = join(e.root, 'plugin/local-config.json');
  const { getConfig } = await import(pathToFileURL(join(core, 'config.js')).href);
  await writeFile(configPath, JSON.stringify({ projectHome: e.root, requiredServers: ['configured-gpu'], resourceDiscoveryMaxAgeMinutes: 3 }));
  const valid = await getConfig();
  const service = new PlanService(e.store, valid);
  assert.deepEqual(service.settings.requiredServers, ['configured-gpu']);
  assert.equal(service.settings.maxAgeMs, 3 * 60000);
  await writeFile(configPath, JSON.stringify({ projectHome: e.root, resourceDiscoveryMaxAgeMinutes: 0 }));
  const invalid = await getConfig();
  assert.throws(() => new PlanService(e.store, invalid), /必须是正数/);
});
