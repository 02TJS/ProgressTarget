$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  $null=Get-Command node -ErrorAction Stop
  $null=Get-Command codex -ErrorAction Stop
  $bundles=@('mcp.mjs','dashboard.mjs','hook.mjs')
  $missing=@($bundles | Where-Object {-not (Test-Path -LiteralPath (Join-Path 'plugins\progress-target\dist' $_))})
  if($missing.Count -gt 0){
    $null=Get-Command npm -ErrorAction Stop
    npm ci
    if($LASTEXITCODE -ne 0){throw '安装构建依赖失败'}
    npm run build
    if($LASTEXITCODE -ne 0){throw '构建运行包失败'}
  }
  node 'scripts\configure.mjs'
  if($LASTEXITCODE -ne 0){throw '路径配置失败'}
  $market=Get-Content -LiteralPath '.agents\plugins\marketplace.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  if($market.name -notmatch '^[A-Za-z0-9_-]+$'){throw '市场名称无效'}
  codex plugin marketplace add $projectRoot
  if($LASTEXITCODE -ne 0){throw '注册项目插件来源失败'}
  codex plugin add ('progress-target@'+$market.name)
  if($LASTEXITCODE -ne 0){throw '安装插件失败'}
  Write-Output '安装完成。请在新 Codex 任务中使用 ProgressTarget。Hook 需在宿主中单独审阅并信任。'
}finally{Pop-Location}
