# Bring the stack up after a Windows restart, without anybody opening Docker
# Desktop by hand.
#
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1
#
# Registered as a logon task by scripts\install-autostart.ps1. The containers
# already carry `restart: unless-stopped`, so the engine coming back is enough
# for them — but only if Docker Desktop itself starts, and only if nobody left
# the stack stopped. This script covers both, then verifies the site answers.
#
# Docker Desktop needs an interactive Windows session: a machine that reboots
# and sits at the lock screen stays down until somebody logs in.

param(
    [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
    # Long enough for a cold boot on a slow disk; the loop exits as soon as the
    # engine answers, so the wait costs nothing on a fast one.
    [int]$EngineTimeoutSeconds = 300,
    [string]$HealthUrl = "https://namnangno.click/login"
)

# Continue, not Stop: `docker info` writes to stderr every time it is asked
# before the engine is listening, and under Stop PowerShell 5.1 turns that
# into a terminating error — the wait loop below would die on its first turn.
# Every step that matters checks $LASTEXITCODE for itself instead.
$ErrorActionPreference = "Continue"
$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "autostart.log"

function Write-Log($message) {
    $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $message
    Add-Content -Path $log -Value $line -Encoding utf8
    Write-Output $line
}

# Keep the log from growing without end; a few boots of history is plenty.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 512KB)) {
    Move-Item $log "$log.old" -Force
}

Write-Log "--- autostart, project $ProjectDir"

$docker = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
    if (Test-Path $docker) {
        # -Autostart keeps the dashboard out of the way; the engine still starts.
        Start-Process $docker -ArgumentList "-Autostart" -ErrorAction Stop
        Write-Log "started Docker Desktop"
    } else {
        Write-Log "ERROR: Docker Desktop not found at $docker"
        exit 1
    }
} else {
    Write-Log "Docker Desktop already running"
}

$deadline = (Get-Date).AddSeconds($EngineTimeoutSeconds)
$engineUp = $false
while ((Get-Date) -lt $deadline) {
    # 2>$null, never 2>&1: the second form wraps each stderr line in an
    # ErrorRecord and trips PowerShell's error handling on a command that is
    # merely being asked too early.
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $engineUp = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $engineUp) {
    Write-Log "ERROR: engine still not answering after ${EngineTimeoutSeconds}s"
    exit 1
}
Write-Log "engine up"

# Idempotent: containers already running are left alone. This is what recovers
# a stack somebody stopped by hand, which `restart: unless-stopped` will not.
Push-Location $ProjectDir
try {
    $composeLog = Join-Path $logDir "autostart-compose.log"
    docker compose up -d *> $composeLog
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: compose up failed, see $composeLog"
        exit 1
    }
    Write-Log "compose up -d ok"
} finally {
    Pop-Location
}

# The tunnel needs a moment to reconnect to Cloudflare before the public name
# resolves to anything.
$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline) {
    try {
        $status = (Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10).StatusCode
        if ($status -eq 200) { Write-Log "site answering 200"; exit 0 }
    } catch {
        # 5xx from Cloudflare while the tunnel reconnects: keep waiting.
    }
    Start-Sleep -Seconds 10
}
Write-Log "WARNING: containers are up but $HealthUrl did not answer 200 in time"
exit 0
