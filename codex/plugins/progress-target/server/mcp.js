import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getConfig } from '../core/config.js';
import { PlanStore, validId } from '../core/storage.js';
import { PlanService, summary } from '../core/operations.js';
import { decideContinuation } from '../core/continuation.js';
import { ensureDashboard } from './dashboard.js';

const config = await getConfig();
const store = new PlanStore(config.dataDir);
const service = new PlanService(store, config);
const object = z.object({}).passthrough();
const scope = { threadId: z.string().min(1).describe('Actual current CODEX_THREAD_ID from the calling task shell or trusted hook. Never use a root session ID, another task ID, or the shared MCP server environment.') };
const server = new McpServer({ name: 'progress-target', version: '0.1.0' }, {
  instructions: 'Read GUIDE.md. Every call requires the calling task’s actual threadId. Obtain CODEX_THREAD_ID in that task’s shell with scripts/current-context.mjs; never infer identity from a shared workspace, root session or MCP process. Never select another task’s plan. Use plan_get before mutations and pass revision. New/revised plans are paused until the user requests execution; pending planning may defer resource discovery and leave measurements null. Existing v1 plans can be revised, extended and closed under legacy gates without migration. Use plan_open for the scoped live dashboard. Stage closure is not final-objective acceptance. After legal overdue delivery, follow continuation.nextPhaseAllowed/nextPhaseId immediately within existing authorization.',
});
function result(value) {
  const next = value?.timeline ? decideContinuation(value) : null;
  const payload = value?.timeline ? { plan: summary(value), continuation: next } : value;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
}
function safe(handler) {
  return async args => {
    try { validId(args.threadId); return await handler(args); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }], structuredContent: { error: error.code || 'CONTRACT_REJECTED', message: error.message } }; }
  };
}
server.registerTool('plan_create', {
  title: '建立进度计划',
  description: 'Create and bind an independent v2 plan to the current task. Defaults to paused with pending phases; do not execute on a planning-only request. Pending resourceDiscovery may be {deferred:true,reason,servers:[]}, measurements may be null. Use GUIDE.md and the contract example. An unfinished current plan must be revised instead of silently replaced. Set executionState=active only after explicit user intent to execute.',
  inputSchema: {
    ...scope, title: z.string().min(1), introduction: z.string().min(1), workspaceRoot: z.string().min(1),
    executionState: z.enum(['paused', 'active']).default('paused'), finalObjective: object,
    timeline: z.array(object).min(1),
  }, annotations: { readOnlyHint: false, destructiveHint: false },
}, safe(async args => result(await service.create(args))));

server.registerTool('plan_get', {
  title: '读取计划与进度',
  description: 'Read the current task’s plan; an empty binding returns plan:null and never falls back to another task. Optional planId must belong to this task. history=true lists only this task’s plans. detail=true includes the full contract. Use revision for mutations.',
  inputSchema: { ...scope, planId: z.string().optional(), detail: z.boolean().default(false), history: z.boolean().default(false) },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, safe(async args => {
  if (args.history) {
    const catalog = await store.catalog({ threadId: args.threadId });
    return result({ threadId: args.threadId, plans: catalog.plans.map(summary), warnings: catalog.warnings });
  }
  const plan = args.planId ? await store.forThread(args.threadId, args.planId) : await store.current(args.threadId);
  if (plan) return args.detail ? result({ plan, continuation: decideContinuation(plan) }) : result(plan);
  return result({ threadId: args.threadId, plan: null, message: '当前对话尚未制定计划' });
}));

server.registerTool('phase_update', {
  title: '更新阶段与验收',
  description: 'Update a planned phase through quality/deliverable/deadline gates. Metrics accept {key,value} patches; deliverables accept {name,status,evidence}. Starting/replanning needs fresh executionPlan; unfinished in-progress updates need attempt with summary/findings/adjustment. Thresholds cannot be lowered after start.',
  inputSchema: { ...scope, planId: z.string().optional(), expectedRevision: z.number().int().positive(), phaseId: z.string(), patch: object },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, safe(async args => {
  const plan = await store.forThread(args.threadId, args.planId);
  return result(await service.updatePhase({ ...args, planId: plan.id }));
}));

server.registerTool('plan_manage', {
  title: '管理计划与最终验收',
  description: 'Manage the current task’s plan. revise-plan accepts the complete desired pending timeline and automatically preserves execution history; it saves paused. Existing v1 plans use their original contract for revise/append/finalize; do not force migration. Removing phases, importing, migrating, filling historical audit fields or adopting an unowned legacy plan requires actual user authorization plus userAuthorized=true and reason. bind cannot take another task’s plan. v2 finalize needs real final measurements and evidence; v1 finalize closes verified stages without claiming v2 acceptance. Finished acceptance is protected and archived when necessary follow-up phases are added. set-execution supports active/waiting/paused/blocked; waiting is not a scheduler.',
  inputSchema: {
    ...scope, operation: z.enum(['revise-plan', 'set-execution', 'bind', 'append-phase', 'finalize', 'import-plan', 'migrate-plan', 'audit-phase', 'delete-phase', 'delete-plan']),
    planId: z.string().optional(), expectedRevision: z.number().int().positive().optional(),
    phaseId: z.string().optional(), userAuthorized: z.boolean().optional(), reason: z.string().optional(),
    state: z.enum(['active', 'waiting', 'paused', 'blocked']).optional(), nextAction: z.string().optional(), waitingUntil: z.string().optional(),
    workspaceRoot: z.string().optional(), originSessionId: z.string().optional(), title: z.string().optional(), introduction: z.string().optional(),
    plan: object.optional(), phase: object.optional(), supplement: object.optional(), timeline: z.array(object).optional(),
    finalObjective: object.optional(), metrics: z.array(object).optional(), deliverables: z.array(object).optional(),
  }, annotations: { readOnlyHint: false, destructiveHint: true },
}, safe(async args => {
  if (['import-plan', 'bind'].includes(args.operation)) return result(await service.manage(args));
  const plan = await store.forThread(args.threadId, args.planId);
  return result(await service.manage({ ...args, planId: plan.id }));
}));

server.registerTool('plan_open', {
  title: '查看实时进度看板',
  description: 'Open the current task’s read-only live dashboard. The URL and every data request are scoped to threadId. An empty task stays empty. Optional planId must belong to this task. Refreshing does not call the model.',
  inputSchema: { ...scope, planId: z.string().optional() }, annotations: { readOnlyHint: true, destructiveHint: false },
}, safe(async args => {
  const plan = args.planId ? await store.forThread(args.threadId, args.planId) : await store.current(args.threadId);
  const dashboard = await ensureDashboard(config);
  const query = new URLSearchParams({ thread: args.threadId });
  if (plan) query.set('plan', plan.id);
  return result({ threadId: args.threadId, planId: plan?.id || null, url: dashboard.url + '/?' + query, readOnly: true });
}));
await server.connect(new StdioServerTransport());
