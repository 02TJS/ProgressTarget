// Read-only host inventory. Does not create tasks, run hooks, or change trust.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the actual desktop app-server executable path');
const projectHome = resolve(process.cwd());
const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd: projectHome, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(); let nextId = 0;
child.stderr.on('data', () => {});
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let value; try { value = JSON.parse(line); } catch { return; }
  const waiter = pending.get(value.id); if (!waiter) return;
  pending.delete(value.id); clearTimeout(waiter.timer);
  if (value.error) waiter.reject(new Error(JSON.stringify(value.error))); else waiter.resolve(value.result);
});
const fail = error => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); };
child.on('error', fail); child.on('exit', code => fail(new Error('Host inventory process exited: ' + code)));
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  const host = await request('initialize', { clientInfo: { name: 'progress_target_hook_inventory', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const result = await request('hooks/list', { cwds: [projectHome] });
  const related = value => /progress.target/i.test(JSON.stringify(value));
  const record = {
    at: new Date().toISOString(), executable,
    version: execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(),
    host, readOnly: true, nativeEventDispatchVerified: false,
    data: result.data.map(entry => ({ cwd: entry.cwd, hooks: entry.hooks.filter(related), errors: entry.errors.filter(related), warnings: entry.warnings.filter(related) })),
  };
  await writeFile(join(projectHome, 'qa/host-hooks-inventory.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
} finally {
  lines.close(); child.stdin.end(); child.kill();
}
