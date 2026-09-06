$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$statePath=Join-Path $projectRoot 'runtime\dashboard.json'
if(-not (Test-Path -LiteralPath $statePath)){Write-Output '看板尚未启动。';exit 0}
$dashboardInfo=Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$dashboardUrl=[Uri]$dashboardInfo.url
if($dashboardUrl.Host -ne '127.0.0.1'){throw '拒绝访问非本地看板地址'}
try{$health=Invoke-RestMethod -Uri ($dashboardInfo.url+'/health') -TimeoutSec 3}catch{Write-Output '看板已停止。';exit 0}
if($health.name -ne 'progress-target' -or $health.instanceId -ne $dashboardInfo.instanceId -or $health.pid -ne $dashboardInfo.pid){throw '看板进程身份不匹配，未停止任何进程。'}
$dashboardProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$dashboardInfo.pid)
$expectedEntry=(Join-Path $projectRoot 'plugins\progress-target\dist\dashboard.mjs').Replace('/','\')
if(-not $dashboardProcess -or -not $dashboardProcess.CommandLine.Replace('/','\').Contains($expectedEntry)){throw '进程不是此项目的看板，未停止。'}
Stop-Process -Id ([int]$dashboardInfo.pid)
Write-Output '看板已停止；计划文件与 Codex 任务保留。'
