[CmdletBinding()]
param(
    [switch]$Offline
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or is not in PATH."
}

$ComposeVersionText = (& docker compose version --short)
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose v2.20 or newer is required."
}
$ComposeVersionMatch = [regex]::Match($ComposeVersionText, "(\d+)\.(\d+)(?:\.(\d+))?")
if (-not $ComposeVersionMatch.Success) {
    throw "Unable to parse Docker Compose version: $ComposeVersionText"
}
$ComposePatch = if ($ComposeVersionMatch.Groups[3].Success) {
    [int]$ComposeVersionMatch.Groups[3].Value
} else {
    0
}
$ComposeVersion = [version]::new(
    [int]$ComposeVersionMatch.Groups[1].Value,
    [int]$ComposeVersionMatch.Groups[2].Value,
    $ComposePatch
)
if ($ComposeVersion -lt [version]"2.20.0") {
    throw "Docker Compose v2.20 or newer is required (found $ComposeVersionText)."
}

$DaemonOS = (& docker info --format "{{.OSType}}" 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop/Engine is not running."
}
if ($DaemonOS.Trim() -ne "linux") {
    throw "Docker must use Linux containers. In Docker Desktop on Windows, switch to Linux containers."
}

if ($Offline) {
    Write-Host "Starting with locally loaded images (offline mode)..."
} else {
    Write-Host "Pulling prebuilt images for this machine..."
    Invoke-Docker compose pull
}

Invoke-Docker compose up -d --no-build --pull never
Invoke-Docker compose ps

Write-Host ""
Write-Host "Medical AIS3 is starting at http://127.0.0.1:8100"
