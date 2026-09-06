import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService } from '../plugins/progress-target/core/operations.js';
import { createDashboard } from '../plugins/progress-target/server/dashboard.js';
import { spawn } from 'node:child_process';
import { planArgs } from './fixtures.mjs';

async function root() {const parent=resolve('qa/test-runs');await mkdir(parent,{recursive:true});return mkdtemp(join(parent,'integration-'));}
test('built MCP bundle exposes valid tools and creates/updates/reads complete plans',async()=>{
  const home=await root();
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('plugins/progress-target/dist/mcp.mjs')],env:{...process.env,PROGRESS_TARGET_HOME:home},stderr:'pipe'});
  const client=new Client({name:'progress-target-tests',version:'0.1.0'});
  let errors='';transport.stderr?.on('data',chunk=>errors+=chunk);
  try{
    await client.connect(transport);
    const tools=await client.listTools();assert.equal(tools.tools.length,5);
    const schema=tools.tools.find(t=>t.name==='plan_create').inputSchema;
    assert.equal(schema.properties.timeline.type,'array');assert.ok(!schema.required.includes('phase_id'));
    const created=await client.callTool({name:'plan_create',arguments:planArgs(home,Date.now(),1)});
    assert.ok(!created.isError,JSON.stringify(created));const plan=created.structuredContent.plan;
    assert.equal(plan.schemaVersion,2);assert.equal(plan.total,1);
    const updated=await client.callTool({name:'phase_update',arguments:{threadId:'test-thread',planId:plan.id,expectedRevision:plan.revision,phaseId:'phase-1',patch:{progress:8}}});
    assert.ok(!updated.isError,JSON.stringify(updated));
    const full=await client.callTool({name:'plan_get',arguments:{threadId:'test-thread',planId:plan.id,detail:true}});
    assert.equal(full.structuredContent.plan.timeline[0].progress,8);
    assert.equal(full.structuredContent.plan.finalObjective.metrics.length,1);
    assert.equal(errors,'');
  }finally{await client.close();}
});
test('built hook bundle reads JSON from stdin and respects Stop and Interrupt',async()=>{
  const home=await root();
  const store=new PlanStore(join(home,'runtime/data')),service=new PlanService(store);
  const plan=await service.create(planArgs(home,Date.now(),1));
  const run=event=>new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,[resolve('plugins/progress-target/dist/hook.mjs')],{env:{...process.env,PROGRESS_TARGET_HOME:home},windowsHide:true});
    let output='',error='';
    child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);
    child.on('exit',code=>{try{assert.equal(code,0,error);assert.equal(error,'');resolveResult(JSON.parse(output));}catch(err){reject(err);}});
    child.stdin.end(JSON.stringify({hook_event_name:event,thread_id:'test-thread',session_id:'test-session',cwd:home}));
  });
  const start=await run('SessionStart');assert.match(start.hookSpecificOutput.additionalContext,new RegExp(plan.id));
  assert.equal((await run('Stop')).decision,'block');
  assert.deepEqual(await run('Interrupt'),{});
  assert.equal((await store.read(plan.id)).execution.state,'paused');
  assert.deepEqual(await run('Stop'),{});
});

test('built MCP rejects invalid nested evidence and preserves scoped history with unrelated corrupt files', async () => {
  const home = await root(), store = new PlanStore(join(home, 'runtime/data'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('plugins/progress-target/dist/mcp.mjs')], env: { ...process.env, PROGRESS_TARGET_HOME: home }, stderr: 'pipe' });
  const client = new Client({ name: 'boundary-mcp-tests', version: '1' });
  const call = (name, args) => client.callTool({ name, arguments: { threadId: 'boundary-thread', ...args } });
  try {
    await client.connect(transport);
    const args = { ...planArgs(home, Date.now(), 1), threadId: 'boundary-thread' };
    args.timeline[0].deliverables[0].evidence = {};
    assert.equal((await call('plan_create', args)).isError, true);
    assert.equal(await store.current('boundary-thread'), null);
    args.timeline[0].deliverables[0].evidence = '';
    const created = await call('plan_create', args); assert.ok(!created.isError, JSON.stringify(created));
    const p = created.structuredContent.plan;
    await writeFile(store.path('broken-another-thread'), '{broken');
    const history = await call('plan_get', { history: true });
    assert.ok(!history.isError, JSON.stringify(history));
    assert.deepEqual(history.structuredContent.plans.map(item => item.id), [p.id]);
    assert.ok(history.structuredContent.warnings.length);
    assert.equal((await call('plan_get', { detail: true })).structuredContent.plan.id, p.id);
  } finally { await client.close(); }
});
test('dashboard serves plans, exports, assets and live change events without a model',async()=>{
  const home=await root(),dataDir=join(home,'data');
  const store=new PlanStore(dataDir),service=new PlanService(store);
  const plan=await service.create(planArgs(home,Date.now(),1));
  const server=await createDashboard({dataDir,runtimeDir:home,projectHome:home,port:0},{writeState:false});
  const controller=new AbortController();
  try{
    const health=await(await fetch(server.url+'/health')).json();assert.equal(health.name,'progress-target');
    assert.match(await(await fetch(server.url+'/')).text(),/ProgressTarget/);
    const list=await(await fetch(server.url+'/api/plans?thread=test-thread')).json();assert.equal(list.plans[0].id,plan.id);
    const exported=await fetch(server.url+'/api/plans/'+plan.id+'?thread=test-thread&download=1');assert.match(exported.headers.get('content-disposition'),/attachment/);
    assert.equal((await exported.json()).schemaVersion,2);
    assert.equal((await fetch(server.url+'/api/plans',{headers:{Origin:'https://example.invalid'}})).status,403);
    assert.equal((await fetch(server.url+'/api/plans',{method:'POST'})).status,405);
    const response=await fetch(server.url+'/api/events?thread=test-thread',{signal:controller.signal});
    const reader=response.body.getReader(),decoder=new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value),/connected/);
    await service.updatePhase({planId:plan.id,phaseId:'phase-1',expectedRevision:plan.revision,patch:{progress:20}});
    const timer=setTimeout(()=>controller.abort(),4000);
    try{assert.match(decoder.decode((await reader.read()).value),/change/);}finally{clearTimeout(timer);}
  }finally{controller.abort();await server.close();}
});

test('one shared MCP process isolates every tool and dashboard request by the calling thread', async () => {
  const home = await root(), dataDir = join(home, 'runtime/data');
  const dashboard = await createDashboard({ dataDir, runtimeDir: join(home, 'runtime'), projectHome: home, port: 0 });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('plugins/progress-target/dist/mcp.mjs')], env: { ...process.env, PROGRESS_TARGET_HOME: home, CODEX_THREAD_ID: 'shared-server-is-not-the-caller' }, stderr: 'pipe' });
  const client = new Client({ name: 'thread-isolation-tests', version: '1' });
  const call = (name, args) => client.callTool({ name, arguments: args });
  try {
    await client.connect(transport);
    for (const tool of (await client.listTools()).tools) assert.ok(tool.inputSchema.required.includes('threadId'), tool.name);
    assert.equal((await call('plan_get', {})).isError, true);
    const args = threadId => {
      const value = { ...planArgs(home, Date.now(), 1), threadId }; delete value.executionState;
      value.timeline[0].metrics[0].value = null;
      value.timeline[0].executionPlan.resourceDiscovery = { deferred: true, reason: '仅制定计划' };
      return value;
    };
    const createdA = await call('plan_create', args('thread-a')); assert.ok(!createdA.isError, JSON.stringify(createdA));
    const a = createdA.structuredContent.plan;
    assert.equal(a.execution.state, 'paused');
    assert.equal((await call('plan_get', { threadId: 'thread-b' })).structuredContent.plan, null);
    const createdB = await call('plan_create', args('thread-b')); assert.ok(!createdB.isError, JSON.stringify(createdB));
    const b = createdB.structuredContent.plan;
    assert.notEqual(a.id, b.id);
    assert.equal((await call('plan_get', { threadId: 'thread-a' })).structuredContent.plan.id, a.id);
    const ownHistory = await call('plan_get', { threadId: 'thread-a', history: true });
    assert.deepEqual(ownHistory.structuredContent.plans.map(p => p.id), [a.id]);
    for (const name of ['plan_get', 'phase_update', 'plan_manage', 'plan_open']) {
      const attempted = await call(name, { threadId: 'thread-b', planId: a.id, expectedRevision: a.revision, phaseId: 'phase-1', patch: { progress: 30 }, operation: 'delete-plan', userAuthorized: true, reason: '测试错误归属' });
      assert.equal(attempted.isError, true, name);
      assert.equal(attempted.structuredContent.error, 'THREAD_MISMATCH', name);
    }
    const revised = await call('plan_manage', { threadId: 'thread-a', operation: 'revise-plan', expectedRevision: a.revision, title: '当前对话的新范围' });
    assert.ok(!revised.isError, JSON.stringify(revised));
    assert.equal(revised.structuredContent.plan.execution.state, 'paused');
    const opened = await call('plan_open', { threadId: 'thread-a' }); assert.ok(!opened.isError, JSON.stringify(opened));
    const url = new URL(opened.structuredContent.url);
    assert.equal(url.searchParams.get('thread'), 'thread-a');
    assert.equal(url.searchParams.get('plan'), a.id);
    const list = await (await fetch(dashboard.url + '/api/plans?thread=thread-a')).json();
    assert.deepEqual(list.plans.map(p => p.id), [a.id]);
    assert.equal(list.currentPlanId, a.id);
    assert.deepEqual((await (await fetch(dashboard.url + '/api/plans')).json()).plans, []);
    assert.deepEqual((await (await fetch(dashboard.url + '/api/plans?thread=thread-c')).json()).plans, []);
    assert.equal((await fetch(dashboard.url + '/api/plans/' + a.id + '?thread=thread-b&download=1')).status, 403);
    assert.equal((await fetch(dashboard.url + '/api/plans/' + a.id + '?demo=1')).status, 403);
    const exported = await fetch(dashboard.url + '/api/plans/' + a.id + '?thread=thread-a&download=1');
    assert.equal(exported.status, 200); assert.equal((await exported.json()).ownerThreadId, 'thread-a');
    const empty = await call('plan_open', { threadId: 'thread-c' });
    assert.equal(empty.structuredContent.planId, null);
    assert.equal(new URL(empty.structuredContent.url).searchParams.get('thread'), 'thread-c');
  } finally { await client.close(); await dashboard.close(); }
});

test('built MCP keeps legacy import, revision, extension, execution and closure usable without v2 migration', async () => {
  const home = await root();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('plugins/progress-target/dist/mcp.mjs')], env: { ...process.env, PROGRESS_TARGET_HOME: home }, stderr: 'pipe' });
  const client = new Client({ name: 'legacy-parity-tests', version: '1' });
  let current;
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: { threadId: 'legacy-mcp', ...args } });
    assert.ok(!result.isError, JSON.stringify(result));
    if (result.structuredContent.plan) current = result.structuredContent.plan;
    return result.structuredContent;
  };
  try {
    await client.connect(transport);
    const args = planArgs(home, Date.now(), 2);
    args.timeline.forEach(p => { delete p.metricResearch; delete p.objectiveContribution; p.metrics.forEach(m => { delete m.kind; delete m.measurement; delete m.limitations; delete m.thresholdBasis; }); });
    await call('plan_manage', { operation: 'import-plan', userAuthorized: true, reason: '完整验证 DSH 旧计划流程', workspaceRoot: home, plan: { timeline: [args.timeline[0]], introduction: '原计划说明' } });
    await call('plan_manage', { operation: 'revise-plan', expectedRevision: current.revision, timeline: [args.timeline[0]], introduction: '修订旧计划但暂不执行' });
    assert.equal(current.execution.state, 'paused');
    await call('plan_manage', { operation: 'append-phase', expectedRevision: current.revision, phase: args.timeline[1] });
    await call('plan_manage', { operation: 'set-execution', expectedRevision: current.revision, state: 'active' });
    for (const p of args.timeline) {
      await new Promise(done => setTimeout(done, 5));
      const executionPlan = structuredClone(p.executionPlan);
      executionPlan.resourceDiscovery.queriedAt = new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00');
      await call('phase_update', { expectedRevision: current.revision, phaseId: p.id, patch: { status: 'in-progress', executionPlan, attempt: { summary: '读取真实测试状态', findings: '验收尚未提交', adjustment: '提交可验证的产物与结果' } } });
      const completed = await call('phase_update', { expectedRevision: current.revision, phaseId: p.id, patch: { status: 'completed', metrics: [{ key: '验收通过率', value: 100 }], deliverables: [{ name: p.deliverables[0].name, status: 'ready', evidence: 'fixture://legacy-result' }] } });
      if (p.id === 'phase-1') assert.equal(completed.continuation.nextPhaseId, 'phase-2');
    }
    await call('plan_manage', { operation: 'finalize', expectedRevision: current.revision });
    assert.equal(current.schemaVersion, 1); assert.equal(current.execution.state, 'finished');
    assert.equal(current.finalAcceptance, null);
  } finally { await client.close(); }
});
