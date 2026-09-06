import { mkdir, readFile, writeFile, rename, unlink, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export class PlanError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value.includes('..'))
    throw new PlanError('INVALID_ID', '计划或阶段 ID 无效');
  return value;
}

export async function readJson(path, missing = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return missing;
    throw new PlanError('STORAGE_READ_FAILED', '无法读取状态文件，原文件已保留：' + path + '；' + error.message);
  }
}

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await delay(25 * (attempt + 1));
      }
    }
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export class PlanStore {
  constructor(root) { this.root = resolve(root); }
  path(id) { return join(this.root, 'plans', validId(id) + '.json'); }
  async read(id) {
    const value = await readJson(this.path(id));
    if (!value) throw new PlanError('NOT_FOUND', '计划不存在：' + id);
    if (value.id !== id || typeof value.title !== 'string' || typeof value.updatedAt !== 'string' ||
        !Number.isInteger(value.revision) || !Array.isArray(value.timeline) ||
        value.timeline.some(p => !p || typeof p.id !== 'string' || !['pending', 'in-progress', 'completed', 'overdue'].includes(p.status)) ||
        !['active', 'waiting', 'paused', 'blocked', 'finished'].includes(value.execution?.state))
      throw new PlanError('STORAGE_READ_FAILED', '计划状态结构无效，原文件已保留：' + this.path(id));
    return value;
  }
  async list() {
    return (await this.catalog()).plans;
  }
  async catalog({ threadId, demo = false } = {}) {
    if (threadId) validId(threadId);
    const dir = join(this.root, 'plans');
    let files;
    try { files = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return { plans: [], warnings: [] }; throw error; }
    const results = await Promise.allSettled(files.filter(name => name.endsWith('.json')).map(name => this.read(name.slice(0, -5))));
    const plans = results.filter(r => r.status === 'fulfilled').map(r => r.value)
      .filter(p => threadId ? p.ownerThreadId === threadId && !p.isDemo : demo ? p.isDemo : true);
    const unreadable = results.filter(r => r.status === 'rejected' && r.reason.code !== 'NOT_FOUND').length;
    // Do not expose another thread's plan identifiers or file contents in warnings.
    const warnings = unreadable ? [{ code: 'UNREADABLE_PLANS', message: '有计划状态文件无法读取或结构无效，列表可能不完整。原文件已保留，可读取的计划仍可使用。' }] : [];
    return { plans: plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
  }
  async lock(key, operation) {
    const lockPath = join(this.root, 'locks', validId(key));
    await mkdir(dirname(lockPath), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        await mkdir(lockPath);
        await atomicJson(join(lockPath, 'owner.json'), { pid: process.pid, at: Date.now() });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = await readJson(join(lockPath, 'owner.json'));
        if (owner && Date.now() - owner.at > 30000) {
          let alive = true;
          try { process.kill(owner.pid, 0); } catch (check) { alive = check.code !== 'ESRCH'; }
          if (!alive) { await rm(lockPath, { recursive: true, force: true }); continue; }
        }
        if (Date.now() - started > 5000) throw new PlanError('BUSY', '计划正在更新，请稍后读取最新版本再试');
        await delay(30);
      }
    }
    try { return await operation(); }
    finally { await rm(lockPath, { recursive: true, force: true }); }
  }
  async create(plan) {
    return this.lock(plan.id, async () => {
      if (await readJson(this.path(plan.id))) throw new PlanError('ALREADY_EXISTS', '计划 ID 已存在');
      const next = { ...plan, revision: 1 };
      await atomicJson(this.path(plan.id), next);
      return next;
    });
  }
  async update(id, revision, apply) {
    return this.updateLatest(id, async old => {
      if (!Number.isInteger(revision) || old.revision !== revision)
        throw new PlanError('REVISION_CONFLICT', '计划版本已变化，请先 plan_get；当前 revision=' + old.revision);
      return apply(old);
    });
  }
  async updateLatest(id, apply) {
    return this.lock(id, async () => {
      const old = await this.read(id);
      const next = await apply(structuredClone(old));
      if (next === null) return old;
      next.revision = old.revision + 1;
      await atomicJson(this.path(id), next);
      return next;
    });
  }
  async remove(id, revision, audit) {
    return this.lock(id, async () => {
      const old = await this.read(id);
      if (old.revision !== revision) throw new PlanError('REVISION_CONFLICT', '请先读取最新计划版本');
      await atomicJson(join(this.root, 'deletion-audit', id + '-' + randomUUID() + '.json'), audit);
      await unlink(this.path(id));
    });
  }
  bindingKey(sessionId, workspaceRoot) {
    if (!sessionId || !workspaceRoot) throw new PlanError('BINDING_REQUIRED', '会话绑定需要 sessionId 和 workspaceRoot');
    const workspace = resolve(workspaceRoot);
    return createHash('sha256').update((process.platform === 'win32' ? workspace.toLowerCase() : workspace) + '\0' + sessionId).digest('hex');
  }
  async bindThread(plan, threadId) {
    validId(threadId);
    if (plan.ownerThreadId !== threadId) throw new PlanError('THREAD_MISMATCH', '计划不属于当前 Codex 对话');
    await atomicJson(join(this.root, 'threads', threadId, 'current.json'), { planId: plan.id, threadId, workspaceRoot: plan.workspaceRoot });
  }
  async current(threadId) {
    validId(threadId);
    const binding = await readJson(join(this.root, 'threads', threadId, 'current.json'));
    if (!binding) return null;
    let plan;
    try { plan = await this.read(binding.planId); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
    if (plan.ownerThreadId !== threadId) throw new PlanError('THREAD_MISMATCH', '当前对话绑定与计划归属不一致');
    return plan;
  }
  async forThread(threadId, planId) {
    validId(threadId);
    const plan = planId ? await this.read(planId) : await this.current(threadId);
    if (!plan) throw new PlanError('NO_CURRENT_PLAN', '当前 Codex 对话尚未制定计划');
    if (plan.ownerThreadId !== threadId) throw new PlanError('THREAD_MISMATCH', '禁止读取或修改其他 Codex 对话的计划');
    return plan;
  }
  async bind(plan, sessionId, workspaceRoot) {
    const key = this.bindingKey(sessionId, workspaceRoot);
    await this.lock('binding-' + key, async () => {
      await atomicJson(join(this.root, 'bindings', key + '.json'), { planId: plan.id, sessionId, workspaceRoot: resolve(workspaceRoot) });
    });
  }
  async bound(sessionId, workspaceRoot) {
    const key = this.bindingKey(sessionId, workspaceRoot);
    const binding = await readJson(join(this.root, 'bindings', key + '.json'));
    if (!binding) return null;
    try { return await this.read(binding.planId); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
  }
}
