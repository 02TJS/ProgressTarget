"""Build a public, relocatable Codex release without personal runtime data."""
from pathlib import Path
from datetime import datetime, timezone
import json
import zipfile

root = Path(__file__).resolve().parent.parent
output = root / 'dist'
output.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
archive = output / f'ProgressTarget-Codex-{version}.zip'
included_dirs = {'.agents', 'docs', 'examples', 'plugins', 'scripts', 'tests'}
included_files = {
    'README.md', 'README.zh-CN.md', 'LICENSE', 'CHANGELOG.md', '.gitignore', '.npmrc',
    'package.json', 'package-lock.json', '安装插件.cmd', '启动看板.cmd', '停止看板.cmd',
    'runtime/.gitkeep',
}
generated_config = {
    'plugins/progress-target/.mcp.json',
    'plugins/progress-target/hooks/hooks.json',
    'plugins/progress-target/local-config.json',
}
files = []
for path in root.rglob('*'):
    if not path.is_file():
        continue
    rel = path.relative_to(root)
    name = rel.as_posix()
    if rel.parts[0] not in included_dirs and name not in included_files:
        continue
    if name in generated_config:
        continue
    if path.name.endswith('.tmp') or {'__pycache__', 'node_modules', '.git', '.cache'} & set(rel.parts):
        continue
    files.append((path, rel))

manifest = []
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for path, rel in sorted(files, key=lambda pair: pair[1].as_posix()):
        data = path.read_bytes()
        package.writestr('ProgressTarget-Codex/' + rel.as_posix(), data)
        manifest.append(rel.as_posix())

required = [
    '.agents/plugins/marketplace.json', 'README.md', 'README.zh-CN.md',
    'plugins/progress-target/.codex-plugin/plugin.json',
    'plugins/progress-target/skills/progress-target/SKILL.md',
    'plugins/progress-target/dist/mcp.mjs', 'plugins/progress-target/dist/dashboard.mjs',
    'plugins/progress-target/dist/hook.mjs', 'plugins/progress-target/ui/index.html',
    'plugins/progress-target/THIRD-PARTY-NOTICES.md',
    'plugins/progress-target/GUIDE.md',
    'plugins/progress-target/scripts/current-context.mjs',
    'docs/usage.md', 'docs/feature-audit.md',
    'scripts/configure.mjs', 'scripts/Install-Plugin.ps1',
    '启动看板.cmd', '安装插件.cmd', '停止看板.cmd',
]
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None, 'Archive CRC verification failed'
    for name in required:
        assert 'ProgressTarget-Codex/' + name in package.namelist(), f'Missing file: {name}'
    assert not any('/node_modules/' in name for name in package.namelist())
    assert not any(name.startswith('runtime/') and name != 'runtime/.gitkeep' for name in manifest)
    assert not any(name.startswith('qa/') or name in generated_config for name in manifest)

report = {
    'at': datetime.now(timezone.utc).isoformat(), 'version': version,
    'archive': archive.name, 'bytes': archive.stat().st_size,
    'filesCount': len(manifest), 'zipIntegrityPassed': True, 'requiredFilesPassed': True,
    'personalDataExcluded': True, 'generatedPathsExcluded': True,
}
(output / 'release-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=True))
