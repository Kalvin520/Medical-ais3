[CmdletBinding()]
param(
    [string]$Output,
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($Architecture) {
    "x64"   { $Arch = "amd64" }
    "arm64" { $Arch = "arm64" }
    default { throw "Unsupported architecture: $Architecture" }
}

$Images = @(& docker compose config --images | Sort-Object -Unique)
if ($LASTEXITCODE -ne 0 -or $Images.Count -eq 0) {
    throw "Unable to read runtime images from docker-compose.yml."
}

$Platform = "linux/$Arch"
if ($Local) {
    $LocalArchitecture = $null
    foreach ($Image in $Images) {
        & docker image inspect $Image *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Required local image is missing: $Image"
        }
        $ImageArchitecture = (& docker image inspect --format '{{.Architecture}}' $Image).Trim()
        if (-not $LocalArchitecture) {
            $LocalArchitecture = $ImageArchitecture
        } elseif ($LocalArchitecture -ne $ImageArchitecture) {
            throw "Local images contain mixed architectures: $LocalArchitecture and $ImageArchitecture."
        }
    }
    $Arch = $LocalArchitecture
    $Platform = "linux/$Arch"
    Write-Host "Using locally available images for $Platform..."
} else {
    Write-Host "Pulling runtime images for $Platform..."
    foreach ($Image in $Images) {
        & docker pull --platform $Platform $Image
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to pull $Image for $Platform."
        }
    }
}

if (-not $Output) {
    $Output = Join-Path $ProjectDir "dist/medical-ais3-images-$Arch.tar"
}

$Output = [System.IO.Path]::GetFullPath($Output)
$OutputDir = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Write-Host "Writing $Output..."
& docker save --output $Output @Images
if ($LASTEXITCODE -ne 0) {
    throw "docker save failed."
}

$Hash = (Get-FileHash -Algorithm SHA256 $Output).Hash.ToLowerInvariant()
"$Hash  $([System.IO.Path]::GetFileName($Output))" |
    Set-Content -Encoding ascii "$Output.sha256"

Write-Host "Offline image bundle created: $Output"
