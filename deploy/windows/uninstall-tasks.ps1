[CmdletBinding()]
param(
  [Parameter()]
  [string]$ApplicationTaskName = "ITS Balance",

  [Parameter()]
  [string]$BackupTaskName = "ITS Balance Backup"
)

$ErrorActionPreference = "Stop"

foreach ($taskName in @($ApplicationTaskName, $BackupTaskName)) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task: $taskName"
  }
}
