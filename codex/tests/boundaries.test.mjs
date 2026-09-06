import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService } from '../plugins/progress-target/core/operations.js';
import { normalizeFinalObjective, optionalIso } from '../plugins/progress-target/core/contract.js';
import { handleHook } from '../plugins/progress-target/hooks/runner.js';
import { createDashboard } from '../plugins/progress-target/server/dashboard.js';
import { baselineTime, phase, planArgs, execution, iso, attempt, readyPatch } from './fixtures.mjs';

async function env() {
  const parent = resolve('qa/test-runs'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'boundaries-'));
  const store = new PlanStore(join(root, 'data')); let now = baselineTime;
  return { root, store, service: new PlanService(store, {}, () => new Date(now)), now: () => now, tick: (ms = 1000) => now += ms };
}
const update = (e, p, patch) => e.service.updatePhase({ threadId: p.ownerThreadId, planId: p.id, phaseId: p.timeline[0].id, expectedRevision: p.revision, patch });
const manage = (e, p, operation, rest = {}) => e.service.manage({ threadId: p.ownerThreadId, planId: p.id, expectedRevision: p.revision, operation, ...rest });
const final = () => ({ metrics: [{ key: '最终验收通过率', value: 100, evidence: 'fixture://actual-measurement' }], deliverables: [{ name: '最终成果', evidence: 'fixture://actual-output' }] });
async function running(e, args = planArgs(e.root, e.now(), 1)) {
  const p = await e.service.create(args);
  return update(e, p, { status: 'in-progress', executionPlan: execution(e.tick()), attempt });
}
async function closed(e) { const p = await running(e); return update(e, p, { status: 'completed', ...readyPatch(p.timeline[0]) }); }

test('null or structured deliverable evidence cannot close a phase', async () => {
  const e = await env(), p = await running(e), before = await readFile(e.store.path(p.id), 'utf8');
  for (const evidence of [null, {}, [], false, 0, '   ']) {
    const patch = readyPatch(p.timeline[0]); patch.deliverables[0].evidence = evidence;
    await assert.rejects(update(e, p, { ...patch, status: 'completed' }), undefined, JSON.stringify(evidence));
  }
  assert.equal(await readFile(e.store.path(p.id), 'utf8'), before);
});

test('final acceptance requires textual evidence, not coerced objects or booleans', async () => {
  const e = await env(), p = await closed(e);
  for (const field of ['metrics', 'deliverables']) for (const evidence of [{}, [], false, 0]) {
    const values = final(); values[field][0].evidence = evidence;
    await assert.rejects(manage(e, p, 'finalize', values));
  }
});

test('required flags cannot be coerced to remove a missing mandatory output', async () => {
  const e = await env(), args = planArgs(e.root, e.now(), 1);
  args.timeline[0].deliverables.push({ ...args.timeline[0].deliverables[0], name: '另一个必需产物' });
  const p = await running(e, args);
  for (const required of [null, 0, '', 'false', []]) {
    await assert.rejects(update(e, p, { status: 'completed', metrics: readyPatch(p.timeline[0]).metrics, deliverables: [
      { name: p.timeline[0].deliverables[0].name, required },
      { name: '另一个必需产物', status: 'ready', evidence: 'fixture://second-output' },
    ] }));
  }
});

test('stage measurements and output acceptance cannot be redefined after execution starts', async () => {
  const e = await env(), p = await running(e);
  for (const definition of [{ unit: '另一单位' }, { measurement: '仅检查文件存在' }, { kind: 'process' }]) {
    await assert.rejects(update(e, p, { metrics: [{ key: p.timeline[0].metrics[0].key, ...definition }], attempt }));
  }
  await assert.rejects(update(e, p, { deliverables: [{ name: p.timeline[0].deliverables[0].name, acceptance: '只要文件存在' }], attempt }));
  const updated = await update(e, p, { ...readyPatch(p.timeline[0]), status: 'completed' });
  assert.equal(updated.timeline[0].status, 'completed');
});

test('duplicate contract metric keys and output names are rejected after trimming', async () => {
  for (const [scope, field, key] of [['phase', 'metrics', 'key'], ['phase', 'deliverables', 'name'], ['final', 'deliverables', 'name']]) {
    const e = await env(), args = planArgs(e.root, e.now(), 1), target = scope === 'phase' ? args.timeline[0] : args.finalObjective;
    target[field].push({ ...target[field][0], [key]: ' ' + target[field][0][key] + ' ' });
    await assert.rejects(e.service.create(args), undefined, scope + '.' + field);
    assert.equal((await e.store.list()).length, 0);
  }
});

test('final numeric targets reject booleans, arrays and whitespace while retaining numeric strings', () => {
  for (const targetValue of [false, true, [], [100], '   ', null]) {
    const objective = planArgs('.').finalObjective; objective.metrics[0].targetValue = targetValue;
    assert.throws(() => normalizeFinalObjective(objective), undefined, JSON.stringify(targetValue));
  }
  const objective = planArgs('.').finalObjective; objective.metrics[0].targetValue = '100';
  assert.equal(normalizeFinalObjective(objective).metrics[0].targetValue, 100);
});

test('Beijing timestamps reject invalid calendar dates and non-ISO syntax', () => {
  for (const value of ['2026-02-30T12:00:00+08:00', '2025-02-29T12:00:00+08:00', '2026-04-31T12:00:00+08:00', '2026-09-05 12:00:00+08:00', '2026-09-05T24:00:00+08:00']) {
    assert.throws(() => optionalIso(value, 'test timestamp'), undefined, value);
  }
  assert.equal(optionalIso('2024-02-29T12:00:00+08:00', 'time'), '2024-02-29T12:00:00.000+08:00');
});

test('starting in the future cannot permit completion before actual start', async () => {
  const e = await env(), p = await e.service.create(planArgs(e.root, e.now(), 1));
  await assert.rejects(update(e, p, { status: 'in-progress', startedAt: iso(e.now() + 600000), executionPlan: execution(e.tick()), attempt }));
  assert.equal((await e.store.read(p.id)).timeline[0].status, 'pending');
});

test('v2 imports store the normalized research contract used for validation', async () => {
  const e = await env(), args = planArgs(e.root, e.now(), 1);
  args.timeline[0].metricResearch.selectedMetrics = [' 验收通过率 '];
  const p = await e.service.importPlan({ threadId: 'import-thread', workspaceRoot: e.root, userAuthorized: true, reason: '验证带空白的旧契约副本', plan: { ...args, schemaVersion: 2 } });
  assert.deepEqual(p.timeline[0].metricResearch.selectedMetrics, ['验收通过率']);
  assert.equal((await update(e, p, { progress: 10 })).execution.state, 'paused');
});

test('a finalized v1 plan can migrate and later receive real v2 final acceptance', async () => {
  const e = await env(), old = phase('旧阶段');
  Object.assign(old, { status: 'completed', startedAt: iso(e.now() - 10000), completedAt: iso(e.now() - 1000) });
  old.metrics[0].value = 100; old.deliverables[0].status = 'ready'; old.deliverables[0].evidence = 'fixture://historical-output';
  let p = await e.service.importPlan({ threadId: 'legacy-thread', workspaceRoot: e.root, userAuthorized: true, reason: '导入已经结束的 v1', plan: { timeline: [old] } });
  p = await manage(e, p, 'finalize'); const closure = structuredClone(p.events.at(-1));
  p = await manage(e, p, 'migrate-plan', { userAuthorized: true, reason: '明确补充 v2 最终目标', finalObjective: planArgs(e.root).finalObjective, timeline: [phase('旧阶段')] });
  assert.equal(p.execution.state, 'paused');
  assert.deepEqual(p.events.find(event => event.id === closure.id), closure);
  assert.equal(p.timeline[0].completedAt, old.completedAt);
  p = await manage(e, p, 'finalize', final());
  assert.equal(p.finalAcceptance.met, true);
});

test('Interrupt atomically pauses the latest revision without losing a simultaneous write', async () => {
  const e = await env(), p = await running(e), current = e.store.current.bind(e.store); let raced = false;
  e.store.current = async threadId => {
    const snapshot = await current(threadId);
    if (!raced) { raced = true; await update(e, snapshot, { progress: 55, attempt }); }
    return snapshot;
  };
  const input = { hook_event_name: 'Interrupt', thread_id: p.ownerThreadId, cwd: e.root };
  await handleHook(input, e.service);
  const saved = await e.store.read(p.id);
  assert.equal(saved.execution.state, 'paused'); assert.equal(saved.timeline[0].progress, 55);
  await handleHook(input, e.service);
  assert.equal((await e.store.read(p.id)).revision, saved.revision, 'repeated interruption is idempotent');
  await assert.rejects(update(e, saved, { progress: 90, attempt }), { code: 'PLAN_NOT_ACTIVE' });
});

test('Interrupt never reopens acceptance finalized by a simultaneous writer', async () => {
  const e = await env(), p = await closed(e), current = e.store.current.bind(e.store); let raced = false;
  e.store.current = async threadId => {
    const snapshot = await current(threadId);
    if (!raced) { raced = true; await manage(e, snapshot, 'finalize', final()); }
    return snapshot;
  };
  await handleHook({ hook_event_name: 'Interrupt', thread_id: p.ownerThreadId, cwd: e.root }, e.service);
  const saved = await e.store.read(p.id);
  assert.equal(saved.execution.state, 'finished'); assert.equal(saved.finalAcceptance.met, true);
});

test('unreadable unrelated plans do not disable another thread dashboard', async () => {
  const e = await env(), p = await e.service.create(planArgs(e.root, e.now(), 1));
  const broken = e.store.path('broken-other-thread'); await writeFile(broken, '{broken json');
  await writeFile(e.store.path('invalid-other-thread'), '{}');
  const dashboard = await createDashboard({ dataDir: e.store.root, runtimeDir: e.root, projectHome: e.root, port: 0 }, { writeState: false });
  try {
    const response = await fetch(dashboard.url + '/api/plans?thread=' + p.ownerThreadId);
    assert.equal(response.status, 200); const data = await response.json();
    assert.deepEqual(data.plans.map(item => item.id), [p.id]); assert.ok(data.warnings.length);
    assert.equal((await e.store.current(p.ownerThreadId)).id, p.id);
    assert.equal(await readFile(broken, 'utf8'), '{broken json');
  } finally { await dashboard.close(); }
});

test('two simultaneous writes never overwrite each other with the same revision', async () => {
  const e = await env(), p = await e.service.create(planArgs(e.root, e.now(), 1));
  const results = await Promise.allSettled([update(e, p, { progress: 10 }), update(e, p, { progress: 20 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await e.store.read(p.id)).revision, p.revision + 1);
});

test('two simultaneous creations in one thread produce exactly one current plan', async () => {
  const e = await env(), args = planArgs(e.root, e.now(), 1);
  const results = await Promise.allSettled([e.service.create(args), e.service.create(args)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'CURRENT_PLAN_EXISTS');
  assert.equal((await e.store.list()).length, 1);
  assert.equal((await e.store.current(args.threadId)).id, results.find(r => r.status === 'fulfilled').value.id);
});

test('conflicting duplicate final measurements cannot silently select the passing value', async () => {
  const e = await env(), p = await closed(e), values = final();
  values.metrics.push({ ...values.metrics[0], value: 0 });
  await assert.rejects(manage(e, p, 'finalize', values));
  assert.equal((await e.store.read(p.id)).finalAcceptance, null);
});
