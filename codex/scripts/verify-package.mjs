import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, 'qa/test-runs'), { recursive: true });
const target = await mkdtemp(join(root, 'qa/test-runs/package-'));
const manifest = JSON.parse(await readFile(join(root, 'dist/release-manifest.json'), 'utf8'));
const extracted = spawnSync(process.env.PT_PYTHON || 'python', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', join(root, 'dist', manifest.archive), target], { windowsHide: true, encoding: 'utf8' });
assert.equal(extracted.status, 0, extracted.stderr);
const copy = join(target, 'ProgressTarget-Codex');
for (const path of ['node_modules', 'qa', 'runtime/data', 'plugins/progress-target/.mcp.json', 'plugins/progress-target/hooks/hooks.json', 'plugins/progress-target/local-config.json']) {
  await assert.rejects(access(join(copy, path)), { code: 'ENOENT' });
}
const launch = name => new Promise((done, fail) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(copy, 'scripts', name)], { cwd: copy, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => { child.kill(); fail(new Error('Package launcher timeout')); }, 30000);
  child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  child.on('error', error => { clearTimeout(timer); fail(error); });
  child.on('exit', code => { clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); code === 0 ? done() : fail(new Error(output)); });
});
let started = false;
try {
  await launch('Start-Dashboard.ps1'); started = true;
  const state = JSON.parse(await readFile(join(copy, 'runtime/dashboard.json'), 'utf8'));
  const health = await (await fetch(state.url + '/health')).json();
  assert.equal(health.dataDir, join(copy, 'runtime/data'));
  assert.equal((await fetch(state.url + '/')).status, 200);
  const unscoped = await (await fetch(state.url + '/api/plans')).json();
  assert.deepEqual(unscoped.plans, []);
  const plans = await (await fetch(state.url + '/api/plans?demo=1')).json();
  assert.deepEqual(plans.plans, []);
  const seeded = spawnSync(process.execPath, [join(copy, 'scripts/seed-demo.mjs')], { cwd: copy, windowsHide: true, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  const demos = await (await fetch(state.url + '/api/plans?demo=1')).json();
  assert.deepEqual(demos.plans.map(p => p.id), ['demo-research']);
  const { PlanStore } = await import('../plugins/progress-target/core/storage.js');
  assert.deepEqual((await new PlanStore(join(copy, 'runtime/data')).list()).map(p => p.id), ['demo-research']);
  const mcp = JSON.parse(await readFile(join(copy, 'plugins/progress-target/.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers['progress-target'].env.PROGRESS_TARGET_HOME, copy);
  assert.ok(mcp.mcpServers['progress-target'].args[0].startsWith(copy.replaceAll('\\', '/')));
  await writeFile(join(root, 'qa/package-smoke.json'), JSON.stringify({ at: new Date().toISOString(), extractedCopyStarts: true, noNodeModulesNeeded: true, dataIsInsideExtractedCopy: true, mcpPathRebased: true, noPersonalDataOrPaths: true, initiallyEmpty: true, demoOnlyCreatedExplicitly: true, url: state.url }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: 7, copy, url: state.url }));
} finally { if (started) await launch('Stop-Dashboard.ps1'); }
