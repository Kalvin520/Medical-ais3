[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Archive = [System.IO.Path]::GetFullPath($Archive)

if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    throw "Image archive not found: $Archive"
}

$ChecksumFile = "$Archive.sha256"
if (Test-Path -LiteralPath $ChecksumFile -PathType Leaf) {
    $Expected = ((Get-Content -LiteralPath $ChecksumFile -TotalCount 1) -split "\s+")[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        throw "SHA-256 verification failed for $Archive."
    }
    Write-Host "SHA-256 verification passed."
}

& docker load --input $Archive
if ($LASTEXITCODE -ne 0) {
    throw "docker load failed."
}

& (Join-Path $ProjectDir "scripts/start.ps1") -Offline
if ($LASTEXITCODE -ne 0) {
    throw "Offline startup failed."
}
