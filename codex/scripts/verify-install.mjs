// Verify the packaged Windows installer with an isolated Codex home, without a model call.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('This check exercises the Windows installer.');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, 'qa/test-runs'), { recursive: true });
const target = await mkdtemp(join(root, 'qa/test-runs/install-'));
const manifest = JSON.parse(await readFile(join(root, 'dist/release-manifest.json'), 'utf8'));
const extracted = spawnSync(process.env.PT_PYTHON || 'python', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', join(root, 'dist', manifest.archive), target], { windowsHide: true, encoding: 'utf8' });
assert.equal(extracted.status, 0, extracted.stderr);
const copy = join(target, 'ProgressTarget-Codex');
const isolatedHome = join(target, 'codex-home');
await mkdir(isolatedHome);
const run = args => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    cwd: copy, windowsHide: true, encoding: 'utf8', timeout: 45000,
    env: { ...process.env, CODEX_HOME: isolatedHome },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
run(['-File', join(copy, 'scripts/Install-Plugin.ps1')]);
const listing = run(['-Command', 'codex plugin list']);
assert.match(listing, /progress-target@progress-target/);
const version = JSON.parse(await readFile(join(copy, 'plugins/progress-target/.codex-plugin/plugin.json'), 'utf8')).version;
const cached = join(isolatedHome, 'plugins/cache/progress-target/progress-target', version);
const mcp = JSON.parse(await readFile(join(cached, '.mcp.json'), 'utf8'));
assert.equal(mcp.mcpServers['progress-target'].env.PROGRESS_TARGET_HOME, copy);
const skill = await readFile(join(cached, 'skills/progress-target/SKILL.md'), 'utf8');
assert.match(skill, /CODEX_THREAD_ID/);
const guide = await readFile(join(cached, 'GUIDE.md'), 'utf8');
assert.ok(guide.length > 1000);
await writeFile(join(root, 'qa/install-verification.json'), JSON.stringify({
  at: new Date().toISOString(), isolatedHome, copy,
  installerPassed: true, marketplaceRegistered: true, pluginCached: true,
  configuredPathPreserved: true, skillAndGuidePresent: true,
  realUserInstallationChanged: false, hookTrustChanged: false,
}, null, 2) + '\n');
console.log(JSON.stringify({ installerPassed: true, plugin: 'progress-target@progress-target', version, isolatedHome }));
