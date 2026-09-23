# Register (or remove) the logon task that brings the stack up after a restart.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
#
# Runs as the logged-in user, not SYSTEM: Docker Desktop with the WSL2 backend
# needs a real user session, so a task running before anybody logs in would
# only fail. That is also the limit of this approach — see INSTALL.md §9.

param(
    [switch]$Remove,
    [string]$TaskName = "FaceAttendance-Autostart"
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot "autostart.ps1"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed scheduled task $TaskName"
    return
}

if (-not (Test-Path $script)) { throw "Not found: $script" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
    -WorkingDirectory $projectDir

# 30 s of slack so the network stack and WSL are ready before Docker is asked
# to start; the script itself then waits for the engine.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT30S"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force `
    -Description "Khoi dong Docker Desktop va dua stack Face Attendance len sau khi dang nhap Windows." | Out-Null

Write-Output "Registered scheduled task $TaskName (at logon, 30s delay)."
Write-Output "Test now:  Start-ScheduledTask -TaskName $TaskName"
Write-Output "Log:       $projectDir\logs\autostart.log"
