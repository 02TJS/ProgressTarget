param([switch]$OpenBrowser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  $null=Get-Command node -ErrorAction Stop
  if(-not (Test-Path -LiteralPath 'plugins\progress-target\dist\dashboard.mjs')){throw '缺少运行包，请先运行 npm install 和 npm run build。'}
  node 'scripts\configure.mjs' | Out-Null
  if($LASTEXITCODE -ne 0){throw '项目路径配置失败'}
  $dashboardState=node 'scripts\dashboard-control.mjs'
  if($LASTEXITCODE -ne 0){throw '看板启动失败，请查看 runtime\dashboard.log。'}
  $dashboardInfo=$dashboardState | ConvertFrom-Json
  Write-Output $dashboardInfo.url
  if($OpenBrowser){
    $viewUrl=$dashboardInfo.url+'/'
    if($env:CODEX_THREAD_ID){$viewUrl+='?thread='+[Uri]::EscapeDataString($env:CODEX_THREAD_ID)}
    Start-Process $viewUrl
  }
} finally {Pop-Location}
