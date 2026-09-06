import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService } from '../plugins/progress-target/core/operations.js';
import { computeGate, normalizeConfig, normalizeExecutionPlan, optionalIso } from '../plugins/progress-target/core/contract.js';
import { handleHook } from '../plugins/progress-target/hooks/runner.js';
import { baselineTime, execution, phase, planArgs, attempt, readyPatch } from './fixtures.mjs';

async function env() {
  const parent = resolve('qa/test-runs'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'workflow-'));
  let now = baselineTime;
  const store = new PlanStore(join(root, 'data'));
  return { root, store, service: new PlanService(store, {}, () => new Date(now)), now: () => now, tick: () => now += 1000 };
}
function planning(root, threadId = 'thread-a', count = 1) {
  const args = { ...planArgs(root, baselineTime, count), threadId };
  delete args.executionState;
  args.timeline.forEach(p => {
    p.metrics[0].value = null;
    p.executionPlan.resourceDiscovery = { deferred: true, reason: '仅制定计划，获准执行前再查询资源', servers: [] };
  });
  return args;
}
const patchArgs = (p, patch, threadId = p.ownerThreadId) => ({ threadId, planId: p.id, expectedRevision: p.revision, phaseId: p.timeline[0].id, patch });

test('planning stays paused with unmeasured metrics and deferred resource discovery', async () => {
  const e = await env(), p = await e.service.create(planning(e.root));
  assert.equal(p.execution.state, 'paused');
  assert.equal(p.timeline[0].status, 'pending');
  assert.equal(p.timeline[0].metrics[0].value, null);
  assert.equal(p.timeline[0].gatePassed, false);
  assert.equal(p.timeline[0].startedAt, '');
  assert.deepEqual(p.timeline[0].resourceDiscoveryHistory, []);
  assert.deepEqual(await handleHook({ thread_id: 'thread-a', cwd: e.root, hook_event_name: 'Stop' }, e.service), {});
  await assert.rejects(e.service.updatePhase(patchArgs(p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt })), /恢复计划/);
  const updated = await e.service.updatePhase(patchArgs(p, { actionTitle: '重新明确验收范围' }));
  assert.equal(updated.execution.state, 'paused');
});

test('explicit start still needs a real fresh resource snapshot', async () => {
  const e = await env(); let p = await e.service.create(planning(e.root));
  p = await e.service.manage({ operation: 'set-execution', threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, state: 'active' });
  await assert.rejects(e.service.updatePhase(patchArgs(p, { status: 'in-progress', executionPlan: p.timeline[0].executionPlan, attempt })), /执行前必须重新查询/);
  p = await e.service.updatePhase(patchArgs(p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt }));
  assert.equal(p.timeline[0].status, 'in-progress');
  assert.equal(p.timeline[0].resourceDiscoveryHistory.length, 1);
  assert.equal(p.timeline[0].executionPlan.resourceDiscovery.deferred, undefined);
});

test('revise-plan can replace pending metrics and deliverables while remaining paused', async () => {
  const e = await env(); let p = await e.service.create(planning(e.root));
  const pending = planning(e.root).timeline;
  const added = structuredClone(pending[0].metrics[0]); added.key = '可用场景通过率';
  pending[0].metrics = [added];
  pending[0].metricResearch.candidateMetrics[0].key = added.key;
  pending[0].metricResearch.selectedMetrics = [added.key];
  pending[0].deliverables = [{ ...pending[0].deliverables[0], name: '直接可用的成果' }];
  p = await e.service.manage({ operation: 'revise-plan', threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, title: '修改后的范围', timeline: pending });
  assert.equal(p.title, '修改后的范围');
  assert.deepEqual(p.timeline[0].metrics.map(m => m.key), [added.key]);
  assert.equal(p.timeline[0].deliverables[0].name, '直接可用的成果');
  assert.equal(p.execution.state, 'paused');
  assert.equal(p.timeline[0].status, 'pending');
});

test('revise-plan preserves execution history and requires permission to remove a pending phase', async () => {
  const e = await env(); let p = await e.service.create({ ...planArgs(e.root, baselineTime, 3), threadId: 'thread-a' });
  p = await e.service.updatePhase(patchArgs(p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt }));
  p = await e.service.updatePhase(patchArgs(p, { status: 'completed', ...readyPatch(p.timeline[0]) }));
  const history = JSON.stringify(p.timeline[0]);
  const args = { operation: 'revise-plan', threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, timeline: [phase('phase-2')] };
  await assert.rejects(e.service.manage(args), /真实用户授权/);
  await assert.rejects(e.service.manage({ ...args, timeline: p.timeline }), /仅接收 pending/);
  const objective = structuredClone(p.finalObjective); objective.metrics[0].targetValue = 50;
  await assert.rejects(e.service.manage({ ...args, finalObjective: objective }), /保留最终目标/);
  p = await e.service.manage({ ...args, userAuthorized: true, reason: '测试明确删除未开始的第三阶段' });
  assert.equal(JSON.stringify(p.timeline[0]), history);
  assert.deepEqual(p.timeline.map(p => p.id), ['phase-1', 'phase-2']);
  assert.equal(p.execution.state, 'paused');
});

test('two threads in the same workspace get separate plans and cannot cross read, write, delete or bind', async () => {
  const e = await env();
  const [a, b] = await Promise.all([e.service.create(planning(e.root, 'thread-a')), e.service.create(planning(e.root, 'thread-b'))]);
  assert.notEqual(a.id, b.id);
  assert.equal((await e.store.current('thread-a')).id, a.id);
  assert.equal((await e.store.current('thread-b')).id, b.id);
  assert.equal(await e.store.current('empty-thread'), null);
  await assert.rejects(e.store.current(undefined), { code: 'INVALID_ID' });
  const before = await readFile(e.store.path(a.id), 'utf8');
  await assert.rejects(e.store.forThread('thread-b', a.id), { code: 'THREAD_MISMATCH' });
  await assert.rejects(e.service.updatePhase(patchArgs(a, { actionTitle: '错误覆盖' }, 'thread-b')), { code: 'THREAD_MISMATCH' });
  await assert.rejects(e.service.manage({ operation: 'delete-plan', threadId: 'thread-b', planId: a.id, expectedRevision: a.revision, userAuthorized: true, reason: '错误对话' }), { code: 'THREAD_MISMATCH' });
  await assert.rejects(e.service.manage({ operation: 'bind', threadId: 'empty-thread', planId: a.id, userAuthorized: true, reason: '错误对话' }), { code: 'THREAD_MISMATCH' });
  assert.equal(await readFile(e.store.path(a.id), 'utf8'), before);
});

test('concurrent creation in one thread cannot silently replace its unfinished plan', async () => {
  const e = await env(), args = planning(e.root);
  const outcomes = await Promise.allSettled([e.service.create(args), e.service.create(args)]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(o => o.status === 'rejected').reason.code, 'CURRENT_PLAN_EXISTS');
  const first = await e.store.current(args.threadId);
  await assert.rejects(e.service.importPlan({ ...args, plan: first, userAuthorized: true, reason: '测试导入' }), { code: 'CURRENT_PLAN_EXISTS' });
  assert.equal((await e.store.current(args.threadId)).id, first.id);
});

test('finished plans remain in thread history when a new plan starts', async () => {
  const e = await env(); let p = await e.service.create({ ...planArgs(e.root, baselineTime, 1), threadId: 'thread-a' });
  p = await e.service.updatePhase(patchArgs(p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt }));
  p = await e.service.updatePhase(patchArgs(p, { status: 'completed', ...readyPatch(p.timeline[0]) }));
  p = await e.service.manage({ operation: 'finalize', threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, metrics: [{ key: '最终验收通过率', value: 100, evidence: 'fixture://final' }], deliverables: [{ name: '最终成果', evidence: 'fixture://output' }] });
  const before = await readFile(e.store.path(p.id), 'utf8');
  const next = await e.service.create(planning(e.root));
  assert.notEqual(next.id, p.id);
  assert.equal((await e.store.current('thread-a')).id, next.id);
  assert.equal(await readFile(e.store.path(p.id), 'utf8'), before);
});

test('forks sharing a root session keep independent Stop and Interrupt behavior', async () => {
  const e = await env();
  const a = await e.service.create({ ...planning(e.root, 'thread-a'), executionState: 'active' });
  const b = await e.service.create(planning(e.root, 'thread-b'));
  const input = { session_id: 'same-root-session', cwd: e.root, hook_event_name: 'Stop' };
  assert.equal((await handleHook(input, e.service, { CODEX_THREAD_ID: 'thread-a', CODEX_SESSION_ID: 'same-root-session' })).decision, 'block');
  assert.deepEqual(await handleHook(input, e.service, { CODEX_THREAD_ID: 'thread-b', CODEX_SESSION_ID: 'same-root-session' }), {});
  assert.deepEqual(await handleHook(input, e.service, { CODEX_SESSION_ID: 'same-root-session' }), {});
  await handleHook({ ...input, hook_event_name: 'Interrupt', thread_id: 'thread-b' }, e.service);
  assert.equal((await e.store.read(a.id)).execution.state, 'active');
  assert.equal((await e.store.read(b.id)).execution.state, 'paused');
});

test('null measurements never pass any gate and planning rejects trivial or unresearched quality', async () => {
  for (const operator of ['>=', '>', '<=', '<', '==']) assert.equal(computeGate([{ value: null, operator, targetValue: 1 }]), false);
  const e = await env(), args = planning(e.root);
  args.timeline[0].metrics[0].targetValue = 0; args.timeline[0].metrics[0].operator = '>';
  await assert.rejects(e.service.create(args), /质量目标不能全部/);
  const other = planning(e.root); other.timeline[0].metrics[0].key = '未经调研的质量指标';
  await assert.rejects(e.service.create(other), /来自 metricResearch/);
  const invalid = planning(e.root); invalid.timeline[0].metrics[0].targetValue = null;
  await assert.rejects(e.service.create(invalid), /targetValue 必须是数值/);
  invalid.timeline[0].metrics[0].targetValue = 100; invalid.timeline[0].metrics[0].value = '';
  await assert.rejects(e.service.create(invalid), /value 必须是数值或 null/);
});

test('resource coverage and explicit sharding are enforced once execution is concrete', () => {
  const settings = normalizeConfig({ requiredServers: ['gpu-a', 'gpu-b'] });
  const plan = execution(baselineTime, { parallelizable: true, shardable: true });
  plan.resourceDiscovery.servers = ['gpu-a', 'gpu-b'].map(name => ({ name, status: 'available', availableGpus: 1, evidence: 'fixture://query' }));
  plan.resources = ['gpu-a', 'gpu-b'].map((server, i) => ({ id: 'r' + i, work: '独立评估', resource: 'GPU', server, status: 'planned', expectedDeliverable: '分片结果' }));
  assert.throws(() => normalizeExecutionPlan(plan, settings), /shard/);
  plan.resources.forEach((r, i) => { r.shard = '样本分片 ' + i; });
  assert.equal(normalizeExecutionPlan(plan, settings).resources.length, 2);
  plan.resources[1].server = 'gpu-a';
  assert.throws(() => normalizeExecutionPlan(plan, settings), /缺少 gpu-b/);
  assert.throws(() => optionalIso('2026-09-05T12:00:00Z', 'deadlineAt'), /UTC\+08/);
  assert.throws(() => optionalIso('2026-09-05T12:00:00', 'deadlineAt'), /带时区/);
});
