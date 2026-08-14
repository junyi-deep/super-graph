[CmdletBinding()]
param(
    [ValidateSet("amd64", "arm64")]
    [string]$Architecture = "amd64",

    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WebRoot = Join-Path $ProjectRoot "web"

if (-not $OutputPath) {
    $OutputPath = Join-Path $ProjectRoot "dist\super-graph-windows-$Architecture.exe"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $ProjectRoot $OutputPath
}

$GoCommand = Get-Command go -ErrorAction SilentlyContinue
if (-not $GoCommand) {
    throw "Go was not found. Install Go 1.25+ and add go.exe to PATH."
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $NpmCommand) {
    throw "npm was not found. Install Node.js 20+ and add npm to PATH."
}

Write-Host "[1/2] Building the frontend..." -ForegroundColor Cyan
Push-Location $WebRoot
try {
    & $NpmCommand.Source ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

    & $NpmCommand.Source run build
    if ($LASTEXITCODE -ne 0) { throw "The frontend build failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}

Write-Host "[2/2] Building the Windows/$Architecture binary..." -ForegroundColor Cyan
$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$PreviousCgo = $env:CGO_ENABLED
$PreviousGoos = $env:GOOS
$PreviousGoarch = $env:GOARCH
try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = $Architecture

    Push-Location $ProjectRoot
    try {
        & $GoCommand.Source build -trimpath '-ldflags=-s -w' -o $OutputPath ./cmd/server
        if ($LASTEXITCODE -ne 0) { throw "The Go build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
} finally {
    $env:CGO_ENABLED = $PreviousCgo
    $env:GOOS = $PreviousGoos
    $env:GOARCH = $PreviousGoarch
}

Write-Host "Build completed: $OutputPath" -ForegroundColor Green
