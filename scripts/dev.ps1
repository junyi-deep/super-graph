[CmdletBinding()]
param(
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WebRoot = Join-Path $ProjectRoot "web"

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $ProjectRoot ".s-graph\config.json"
} elseif (-not [System.IO.Path]::IsPathRooted($ConfigPath)) {
    $ConfigPath = Join-Path $ProjectRoot $ConfigPath
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

if (-not (Test-Path (Join-Path $WebRoot "node_modules"))) {
    Write-Host "Installing frontend dependencies for the first run..." -ForegroundColor Cyan
    Push-Location $WebRoot
    try {
        & $NpmCommand.Source install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)

    if ($null -ne $Process -and -not $Process.HasExited) {
        & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    }
}

$PreviousConfig = $env:SUPER_GRAPH_CONFIG
$Backend = $null
$Frontend = $null
try {
    $env:SUPER_GRAPH_CONFIG = $ConfigPath

    Write-Host "Starting the backend at http://localhost:7988" -ForegroundColor Cyan
    $Backend = Start-Process `
        -FilePath $GoCommand.Source `
        -ArgumentList @("run", "./cmd/server") `
        -WorkingDirectory $ProjectRoot `
        -NoNewWindow `
        -PassThru

    Write-Host "Starting the frontend development server..." -ForegroundColor Cyan
    $Frontend = Start-Process `
        -FilePath $NpmCommand.Source `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $WebRoot `
        -NoNewWindow `
        -PassThru

    Write-Host "Press Ctrl+C to stop both services." -ForegroundColor Green
    while (-not $Backend.HasExited -and -not $Frontend.HasExited) {
        Start-Sleep -Milliseconds 500
    }

    if ($Backend.HasExited) {
        throw "The backend exited with code $($Backend.ExitCode)."
    }
    throw "The frontend exited with code $($Frontend.ExitCode)."
} finally {
    Stop-ProcessTree $Frontend
    Stop-ProcessTree $Backend
    $env:SUPER_GRAPH_CONFIG = $PreviousConfig
}
