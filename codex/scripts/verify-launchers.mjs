import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, 'qa'), { recursive: true });
// A detached Windows grandchild can retain pipe handles after PowerShell exits.
// Judge the launcher by its exit code and the resulting health record.
const run = args => new Promise((done, fail) => {
  const child = spawn('powershell.exe', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => { child.kill(); fail(new Error('Launcher exceeded 30 seconds')); }, 30000);
  child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  child.on('error', error => { clearTimeout(timer); fail(error); });
  child.on('exit', code => { clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); code === 0 ? done() : fail(new Error(output || 'Launcher exit ' + code)); });
});
const invoke = name => run(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', name)]);
await run(['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath scripts -Filter *.ps1 | ForEach-Object { $parseTokens=$null; $parseErrors=$null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$parseTokens,[ref]$parseErrors) | Out-Null; if($parseErrors.Count){throw ($parseErrors | Out-String)} }"]);
await invoke('Stop-Dashboard.ps1');
await invoke('Start-Dashboard.ps1');
const url = JSON.parse(await readFile(join(root, 'runtime/dashboard.json'), 'utf8')).url;
assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
const first = await (await fetch(url + '/health')).json();
await invoke('Start-Dashboard.ps1');
const second = await (await fetch(url + '/health')).json();
assert.equal(first.instanceId, second.instanceId);
assert.equal(first.pid, second.pid);
const state = JSON.parse(await readFile(join(root, 'runtime/dashboard.json'), 'utf8'));
assert.equal(state.instanceId, first.instanceId);
await writeFile(join(root, 'qa/launcher-verification.json'), JSON.stringify({ at: new Date().toISOString(), shell: 'Windows PowerShell 5.1', scriptsParse: true, stopThenStart: true, reusedSameProcess: true, stateMatchesHealth: true, url, pid: first.pid }, null, 2) + '\n');
console.log(JSON.stringify({ url, passed: 4 }));

await invoke('Stop-Dashboard.ps1');
