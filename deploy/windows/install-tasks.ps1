[CmdletBinding()]
param(
  [Parameter()]
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,

  [Parameter()]
  [string]$ApplicationTaskName = "ITS Balance",

  [Parameter()]
  [string]$BackupTaskName = "ITS Balance Backup"
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )) {
  throw "Запустите PowerShell от имени администратора."
}

$resolvedProject = (Resolve-Path -LiteralPath $ProjectPath).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$startScript = Join-Path $resolvedProject "scripts\start.mjs"
$backupScript = Join-Path $resolvedProject "scripts\backup-state.mjs"
$buildDirectory = Join-Path $resolvedProject "dist"
$environmentFile = Join-Path $resolvedProject ".env.local"

foreach ($requiredPath in @(
    $startScript,
    $backupScript,
    $buildDirectory,
    $environmentFile
  )) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Не найден обязательный путь: $requiredPath"
  }
}

$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest

$startAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument "`"$startScript`"" `
  -WorkingDirectory $resolvedProject
$startTrigger = New-ScheduledTaskTrigger -AtStartup
$startSettings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $ApplicationTaskName `
  -Action $startAction `
  -Trigger $startTrigger `
  -Principal $taskPrincipal `
  -Settings $startSettings `
  -Description "ИТС Баланс: сайт и фоновая синхронизация АТОЛ" `
  -Force | Out-Null

$backupAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument "`"$backupScript`"" `
  -WorkingDirectory $resolvedProject
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$backupSettings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $BackupTaskName `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Principal $taskPrincipal `
  -Settings $backupSettings `
  -Description "Резервная копия общего состояния ИТС Баланс" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $ApplicationTaskName

Write-Host "Задачи установлены:"
Write-Host "  $ApplicationTaskName — запуск при старте Windows"
Write-Host "  $BackupTaskName — ежедневная копия в 02:00"
Write-Host "Приложение запускается из: $resolvedProject"
