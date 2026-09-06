import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const plugin = join(root, 'plugins/progress-target');
const slash = path => path.replaceAll('\\', '/');
const json = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
let old = {};
try { old = JSON.parse(await readFile(join(plugin, 'local-config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await json(join(plugin, 'local-config.json'), { ...old, projectHome: root, port: old.port || 18765, requiredServers: old.requiredServers || [], resourceDiscoveryMaxAgeMinutes: old.resourceDiscoveryMaxAgeMinutes || 10 });
await json(join(plugin, '.mcp.json'), { mcpServers: { 'progress-target': { command: 'node', args: [slash(join(plugin, 'dist/mcp.mjs'))], env: { PROGRESS_TARGET_HOME: root } } } });
const hooks = {};
for (const [name, label] of [['SessionStart', '恢复进度计划'], ['Stop', '检查剩余工作'], ['Interrupt', '保存中断状态']]) {
  hooks[name] = [{ hooks: [{ type: 'command', command: 'node "' + slash(join(plugin, 'dist/hook.mjs')) + '"', timeout: name === 'Interrupt' ? 3 : 10, statusMessage: label }] }];
}
await json(join(plugin, 'hooks/hooks.json'), { hooks });
console.log('项目路径已配置：' + root);
