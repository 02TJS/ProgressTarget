import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const plugin = resolve(root, 'plugins/progress-target');
const built = await build({
  absWorkingDir: root, metafile: true,
  entryPoints: { mcp: plugin + '/server/mcp.js', dashboard: plugin + '/server/dashboard-main.js', hook: plugin + '/hooks/runner.js' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outdir: plugin + '/dist', outExtension: { '.js': '.mjs' }, legalComments: 'linked',
  banner: { js: "import { createRequire as __ptCreateRequire } from 'node:module'; const require = __ptCreateRequire(import.meta.url);" },
});
const dependencies = new Map();
for (const input of Object.keys(built.metafile.inputs)) {
  const parts = input.replaceAll('\\', '/').split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index < 0) continue;
  const length = parts[index + 1].startsWith('@') ? 3 : 2;
  const path = resolve(root, parts.slice(0, index + length).join('/'));
  const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  dependencies.set(metadata.name + '@' + metadata.version, { path, metadata });
}
let notices = '# Third-party notices\n\nThe following dependencies are included in the bundled runtime. Build-only and test-only dependencies are not redistributed in the runtime bundle.\n';
for (const [name, { path, metadata }] of [...dependencies].sort(([a], [b]) => a.localeCompare(b))) {
  const licenseFiles = (await readdir(path)).filter(name => /^(licen[sc]e|copying|notice)([._-]|$)/i.test(name));
  if (!licenseFiles.length) throw new Error('Missing license text for bundled package: ' + name);
  notices += '\n## ' + name + '\n\nLicense: ' + (metadata.license || 'See text below') + '\n';
  for (const file of licenseFiles) notices += '\n### ' + file + '\n\n' + await readFile(join(path, file), 'utf8') + '\n';
}
await writeFile(join(plugin, 'THIRD-PARTY-NOTICES.md'), notices.trimEnd() + '\n');
await mkdir(join(root, 'qa'), { recursive: true });
await writeFile(join(root, 'qa/build-metafile.json'), JSON.stringify(built.metafile, null, 2) + '\n');
await import('./configure.mjs');
console.log('MCP、看板和 Hook 已打包；运行时只需要 Node.js。');
