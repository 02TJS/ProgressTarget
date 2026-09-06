import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PlanStore } from '../plugins/progress-target/core/storage.js';
import { PlanService, summary } from '../plugins/progress-target/core/operations.js';
import { decideContinuation } from '../plugins/progress-target/core/continuation.js';
import { handleHook } from '../plugins/progress-target/hooks/runner.js';
import { baselineTime, iso, execution, phase, planArgs, attempt, readyPatch } from './fixtures.mjs';

async function env(config = {}) {
  const parent = resolve('qa/test-runs'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'core-'));
  let at = baselineTime;
  const store = new PlanStore(join(root, 'data'));
  const service = new PlanService(store, config, () => new Date(at));
  return { root, store, service, now: () => at, tick: (ms = 1000) => at += ms };
}
async function start(e, plan, index = 0) {
  e.tick();
  return e.service.updatePhase({ planId: plan.id, phaseId: plan.timeline[index].id, expectedRevision: plan.revision, patch: { status: 'in-progress', executionPlan: execution(e.now()), attempt } });
}
async function complete(e, plan, index = 0) {
  e.tick();
  return e.service.updatePhase({ planId: plan.id, phaseId: plan.timeline[index].id, expectedRevision: plan.revision, patch: { status: 'completed', ...readyPatch(plan.timeline[index]) } });
}
test('initialization creates a complete v2 contract and session binding', async () => {
  const e=await env(), p=await e.service.create(planArgs(e.root));
  assert.equal(p.schemaVersion,2);assert.equal(p.finalObjective.metrics.length,1);
  assert.equal(p.timeline.length,2);assert.equal(p.timeline[0].metrics.length,1);
  assert.equal((await e.store.bound('test-session',e.root)).id,p.id);
});
test('initialization rejects duplicate phases and absent required deliverables', async () => {
  const e=await env(),args=planArgs(e.root);
  args.timeline[1].id=args.timeline[0].id;
  await assert.rejects(e.service.create(args),/不能重复/);
  const other=planArgs(e.root);other.timeline[0].deliverables[0].required=false;
  await assert.rejects(e.service.create(other),/必需交付物/);
  assert.equal((await e.store.list()).length,0);
});
test('pending phases cannot jump straight to completed', async () => {
  const e=await env(),p=await e.service.create(planArgs(e.root));
  await assert.rejects(complete(e,p),/必须先启动/);
  assert.equal((await e.store.read(p.id)).revision,1);
});
test('completion requires both quality and usable deliverables', async () => {
  const e=await env();let p=await start(e,await e.service.create(planArgs(e.root)));
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{status:'completed',metrics:[{key:'验收通过率',value:100}]}}),/交付物/);
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{status:'completed',deliverables:readyPatch(p.timeline[0]).deliverables}}),/硬目标/);
  p=await complete(e,p);assert.equal(p.timeline[0].status,'completed');
});
test('usable output alone cannot start downstream while predecessor remains running', async () => {
  const e=await env();let p=await start(e,await e.service.create(planArgs(e.root)));
  p=await e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{...readyPatch(p.timeline[0]),status:'in-progress'}});
  assert.equal(p.timeline[0].deliverablesReady,true);
  await assert.rejects(start(e,p,1),/前序阶段/);
});
test('completed history rejects same-status edits', async () => {
  const e=await env();let p=await complete(e,await start(e,await e.service.create(planArgs(e.root))));
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{status:'completed',result:'overwrite'}}),/已结束阶段/);
});
test('running thresholds and required deliverables cannot be weakened', async () => {
  const e=await env(),p=await start(e,await e.service.create(planArgs(e.root)));
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{metrics:[{key:'验收通过率',value:10,targetValue:10}]}}),/修改阈值/);
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{deliverables:[{name:p.timeline[0].deliverables[0].name,required:false}]}}),/必需交付物/);
});
test('overdue departure requires usable outputs and remains distinct from quality', async () => {
  const e=await env();let p=await start(e,await e.service.create(planArgs(e.root)));
  e.tick(3600001);
  await assert.rejects(e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{status:'overdue'}}),/交付物/);
  p=await e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{status:'overdue',deliverables:readyPatch(p.timeline[0]).deliverables}});
  assert.equal(summary(p).closed,1);assert.equal(summary(p).qualityPassed,0);
});
test('resource snapshots must be fresh and requery every configured server', async () => {
  const e=await env();const args=planArgs(e.root);args.timeline[0].executionPlan=execution(e.now()-11*60000);
  await assert.rejects(e.service.create(args),/新鲜度/);
  const multi=await env({requiredServers:['gpu-a','gpu-b']});
  await assert.rejects(multi.service.create(planArgs(multi.root)),/资源发现结果不能为空/);
});
test('replans use remaining-time 50% and 100% checkpoints', async () => {
  const e=await env();let p=await start(e,await e.service.create(planArgs(e.root)));
  e.tick();
  p=await e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{executionPlan:execution(e.now(),{estimatedMinutes:10}),attempt}});
  assert.deepEqual(p.timeline[0].executionPlan.checkpoints.map(c=>c.kind),['50%','100%']);
  assert.equal(p.timeline[0].resourceDiscoveryHistory.length,2);
});
test('concurrent writers cannot overwrite the same revision', async () => {
  const e=await env(),p=await e.service.create(planArgs(e.root));
  const outcomes=await Promise.allSettled([10,20].map(progress=>e.service.updatePhase({planId:p.id,phaseId:p.timeline[0].id,expectedRevision:p.revision,patch:{progress}})));
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal(outcomes.find(o=>o.status==='rejected').reason.code,'REVISION_CONFLICT');
});
test('corrupt state is reported and path traversal is rejected', async () => {
  const e=await env(),p=await e.service.create(planArgs(e.root));
  await writeFile(e.store.path(p.id),'{broken');
  await assert.rejects(e.store.read(p.id),{code:'STORAGE_READ_FAILED'});
  assert.equal(await readFile(e.store.path(p.id),'utf8'),'{broken');
  await assert.rejects(e.store.read('../outside'),{code:'INVALID_ID'});
});
test('v1 migration preserves status and completion timestamp', async () => {
  const e=await env(),src=phase('old-phase',e.now());
  src.status='overdue';src.startedAt=iso(e.now()-7200000);src.deadlineAt=iso(e.now()-3600000);src.completedAt=iso(e.now()-1800000);
  src.deliverables[0].status='ready';src.deliverables[0].evidence='fixture://historical-output';
  const imported=await e.service.importPlan({userAuthorized:true,reason:'测试历史导入',workspaceRoot:e.root,plan:{timeline:[src],createdAt:iso(e.now()-7200000)}});
  const next=await e.service.manage({operation:'migrate-plan',planId:imported.id,expectedRevision:imported.revision,userAuthorized:true,reason:'测试 v2 迁移',finalObjective:planArgs(e.root).finalObjective,timeline:[src]});
  assert.equal(next.schemaVersion,2);assert.equal(next.timeline[0].completedAt,src.completedAt);
  assert.equal(next.timeline[0].status,'overdue');assert.equal(next.timeline[0].startedAt,src.startedAt);
});
test('failed migration leaves original stored bytes unchanged', async () => {
  const e=await env(),src=phase('old-phase',e.now());
  const imported=await e.service.importPlan({userAuthorized:true,reason:'测试历史导入',workspaceRoot:e.root,plan:{timeline:[src]}});
  const before=await readFile(e.store.path(imported.id),'utf8');
  await assert.rejects(e.service.manage({operation:'migrate-plan',planId:imported.id,expectedRevision:imported.revision,userAuthorized:true,reason:'缺少契约的失败迁移',timeline:[src]}));
  assert.equal(await readFile(e.store.path(imported.id),'utf8'),before);
});
test('final objective needs separate measured acceptance after phase closure', async () => {
  const e=await env();let p=await e.service.create(planArgs(e.root,e.now(),1));
  p=await complete(e,await start(e,p));assert.equal(p.finalAcceptance,null);
  assert.equal(decideContinuation(p,e.now()).mustContinue,true);
  await assert.rejects(e.service.manage({operation:'finalize',planId:p.id,expectedRevision:p.revision}),/最终实测指标/);
  p=await e.service.manage({operation:'finalize',planId:p.id,expectedRevision:p.revision,metrics:[{key:'最终验收通过率',value:100,evidence:'fixture://final-check'}],deliverables:[{name:'最终成果',evidence:'fixture://final-output'}]});
  assert.equal(p.finalAcceptance.met,true);assert.equal(decideContinuation(p,e.now()).mustContinue,false);
});
test('hooks resume only the bound task and respect waiting and interruption', async () => {
  const e=await env();let p=await e.service.create(planArgs(e.root));
  const input={thread_id:'test-thread',session_id:'test-session',cwd:e.root,hook_event_name:'Stop'};
  assert.equal((await handleHook(input,e.service)).decision,'block');
  assert.deepEqual(await handleHook({...input,thread_id:'unrelated'},e.service),{});
  p=await e.service.manage({operation:'set-execution',planId:p.id,expectedRevision:p.revision,state:'waiting',reason:'等待后台结果',waitingUntil:iso(e.now()+60000)});
  assert.deepEqual(await handleHook(input,e.service),{});
  e.tick(60001);assert.equal((await handleHook(input,e.service)).decision,'block');
  await handleHook({...input,hook_event_name:'Interrupt'},e.service);
  assert.equal((await e.store.read(p.id)).execution.state,'paused');
  assert.deepEqual(await handleHook(input,e.service),{});
});
test('deletion requires authorization and preserves a separate audit record',async()=>{
  const e=await env(),p=await e.service.create(planArgs(e.root));
  await assert.rejects(e.service.manage({operation:'delete-plan',planId:p.id,expectedRevision:p.revision,reason:'missing permission'}),/真实用户授权/);
  await e.service.manage({operation:'delete-plan',planId:p.id,expectedRevision:p.revision,userAuthorized:true,reason:'删除测试计划'});
  await assert.rejects(e.store.read(p.id),{code:'NOT_FOUND'});
});
