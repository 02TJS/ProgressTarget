import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function getConfig() {
  // Bundled entrypoints live in plugin/dist; source modules in plugin/core or server.
  const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let local = {};
  try { local = JSON.parse(await readFile(resolve(pluginRoot, 'local-config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const projectHome = resolve(process.env.PROGRESS_TARGET_HOME || local.projectHome || resolve(pluginRoot, '../..'));
  return {
    projectHome,
    pluginRoot,
    dataDir: resolve(projectHome, 'runtime/data'),
    runtimeDir: resolve(projectHome, 'runtime'),
    port: Number(process.env.PROGRESS_TARGET_PORT || local.port || 18765),
    requiredServers: local.requiredServers || [],
    resourceDiscoveryMaxAgeMinutes: local.resourceDiscoveryMaxAgeMinutes === undefined ? 10 : local.resourceDiscoveryMaxAgeMinutes,
  };
}
