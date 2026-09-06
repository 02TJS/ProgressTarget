import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { watch, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getConfig } from '../core/config.js';
import { PlanStore, PlanError, validId, atomicJson, readJson } from '../core/storage.js';
import { summary } from '../core/operations.js';

const UI_ROOT = fileURLToPath(new URL('../ui/', import.meta.url));
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);

export async function createDashboard(config, { writeState = true } = {}) {
  const store = new PlanStore(config.dataDir);
  await mkdir(join(config.dataDir, 'plans'), { recursive: true });
  const clients = new Set();
  const instanceId = randomUUID();
  let baseUrl = '';
  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'");
    try {
      const url = new URL(req.url, baseUrl);
      if (!['127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])) return send(res, 403, { error: 'Localhost only' });
      if (req.headers.origin && req.headers.origin !== baseUrl) return send(res, 403, { error: 'Origin rejected' });
      if (req.method !== 'GET') return send(res, 405, { error: 'This dashboard is read-only' }, { allow: 'GET' });
      if (url.pathname === '/health') return send(res, 200, { status: 'ok', name: 'progress-target', version: '0.1.0', instanceId, dataDir: config.dataDir, pid: process.pid });
      const threadId = url.searchParams.get('thread');
      const demo = url.searchParams.get('demo') === '1' && !threadId;
      if (threadId) validId(threadId);
      if (url.pathname === '/api/plans') {
        const { plans, warnings } = threadId || demo ? await store.catalog({ threadId, demo }) : { plans: [], warnings: [] };
        const current = threadId ? await store.current(threadId) : null;
        return send(res, 200, { plans: plans.map(summary), warnings, currentPlanId: current?.id || null, contextRequired: !threadId && !demo, now: new Date().toISOString() });
      }
      if (url.pathname.startsWith('/api/plans/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/plans/'.length));
        if (!threadId && !demo) throw new PlanError('THREAD_REQUIRED', '请从当前 Codex 对话打开其计划看板');
        const plan = threadId ? await store.forThread(threadId, id) : await store.read(id);
        if ((demo && !plan.isDemo) || (threadId && plan.isDemo)) throw new PlanError('THREAD_MISMATCH', '该计划不属于此看板');
        const headers = url.searchParams.has('download') ? { 'content-disposition': 'attachment; filename="' + plan.id + '.json"' } : {};
        return send(res, 200, plan, headers);
      }
      if (url.pathname === '/api/events') {
        if (!threadId && !demo) throw new PlanError('THREAD_REQUIRED', '看板需要当前对话身份');
        res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
        res.write('event: connected\ndata: {}\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const asset = staticFiles.get(url.pathname);
      if (!asset) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': asset[1] + '; charset=utf-8' });
      res.end(await readFile(join(UI_ROOT, asset[0])));
    } catch (error) { send(res, error.code === 'NOT_FOUND' ? 404 : ['THREAD_MISMATCH', 'THREAD_REQUIRED'].includes(error.code) ? 403 : error.code === 'INVALID_ID' ? 400 : 500, { error: error.message }); }
  });
  const initial = config.port;
  for (let offset = 0; ; offset++) {
    try {
      await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(initial === 0 ? 0 : initial + offset, '127.0.0.1', () => { server.off('error', fail); done(); });
      });
      break;
    } catch (error) { if (error.code !== 'EADDRINUSE' || offset >= 20) throw error; }
  }
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  let debounce;
  const watcher = watch(join(config.dataDir, 'plans'), () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { for (const client of clients) client.write('event: change\ndata: {}\n\n'); }, 60);
  });
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 20000);
  heartbeat.unref();
  const info = { url: baseUrl, instanceId, pid: process.pid, projectHome: config.projectHome, dataDir: config.dataDir, startedAt: new Date().toISOString() };
  if (writeState) await atomicJson(join(config.runtimeDir, 'dashboard.json'), info);
  return {
    ...info,
    async close() {
      clearInterval(heartbeat); clearTimeout(debounce); watcher.close();
      for (const client of clients) client.end();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    },
  };
}

async function existingDashboard(config) {
  const state = await readJson(join(config.runtimeDir, 'dashboard.json'));
  if (!state) return null;
  const url = new URL(state.url);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') return null;
  try {
    const response = await fetch(state.url + '/health', { signal: AbortSignal.timeout(1000) });
    const health = await response.json();
    return response.ok && health.name === 'progress-target' && health.instanceId === state.instanceId && health.dataDir === config.dataDir ? state : null;
  } catch { return null; }
}

export async function ensureDashboard(config) {
  const store = new PlanStore(config.dataDir);
  return store.lock('dashboard-start', async () => {
    const current = await existingDashboard(config);
    if (current) return current;
    await mkdir(config.runtimeDir, { recursive: true });
    const log = openSync(join(config.runtimeDir, 'dashboard.log'), 'a');
    const entry = resolve(config.projectHome, 'plugins/progress-target/dist/dashboard.mjs');
    const child = spawn(process.execPath, [entry], {
      cwd: config.projectHome, detached: true, windowsHide: true,
      stdio: ['ignore', log, log], env: { ...process.env, PROGRESS_TARGET_HOME: config.projectHome },
    });
    let failure;
    child.once('error', error => { failure = error; });
    closeSync(log); child.unref();
    for (let i = 0; i < 40; i++) {
      if (failure) throw failure;
      await delay(125);
      const state = await existingDashboard(config);
      if (state) return state;
    }
    throw new Error('看板未能启动，请查看项目 runtime/dashboard.log');
  });
}
