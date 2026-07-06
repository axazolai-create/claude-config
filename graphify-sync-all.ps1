<#
.SYNOPSIS
    Finds all projects under a root folder, builds/updates their graphify
    graphs and registers all of them in the shared global-graph.json.

.PARAMETER ProjectsRoot
    Root folder containing all projects, e.g. C:\Dev

.PARAMETER MaxDepth
    How many folder levels deep to scan for projects (default 3).
    Increase if projects are nested deeper (e.g. C:\Dev\clients\acme\backend).

.PARAMETER InstallHooks
    Also runs 'graphify hook install' in every project - its local graph
    will then rebuild itself automatically on every git commit.

.PARAMETER Exclude
    Folder names to skip entirely while scanning (deps/junk).

.EXAMPLE
    .\graphify-sync-all.ps1 -ProjectsRoot D:\6__Work -InstallHooks

.EXAMPLE
    .\graphify-sync-all.ps1 -ProjectsRoot D:\6__Work -MaxDepth 4
#>

[CmdletBinding()]
param(
    [string]$ProjectsRoot = "D:\6__Work",
    [int]$MaxDepth = 3,
    [switch]$InstallHooks,
    [string[]]$Exclude = @(
        "node_modules", "graphify-out", "bin", "obj", ".venv", "venv",
        "dist", "build", "__pycache__", ".git", "vendor"
    )
)

$ErrorActionPreference = "Continue"
$logFile = Join-Path $ProjectsRoot "graphify-sync.log"
"=== Run started $(Get-Date -Format u) ===" | Out-File -FilePath $logFile -Append -Encoding ascii

function Test-IsExcluded {
    param([string]$Path)
    foreach ($ex in $Exclude) {
        if ($Path -match [regex]::Escape("\$ex\")) { return $true }
    }
    return $false
}

# Project-root markers. Extend freely for your stack.
# (Delphi *.dpr/*.dproj included for legacy systems.)
$markers = @(
    ".git", "package.json", "pyproject.toml",
    "*.sln", "*.csproj", "go.mod", "requirements.txt",
    "*.dpr", "*.dproj", "*.groupproj"
)

Write-Host "Scanning $ProjectsRoot (depth $MaxDepth)..." -ForegroundColor Cyan

$projectDirs = New-Object System.Collections.Generic.HashSet[string]

Get-ChildItem -Path $ProjectsRoot -Directory -Recurse -Depth $MaxDepth -ErrorAction SilentlyContinue |
    Where-Object { -not (Test-IsExcluded $_.FullName) } |
    ForEach-Object {
        $dir = $_.FullName
        foreach ($m in $markers) {
            if (Get-ChildItem -Path $dir -Filter $m -File -ErrorAction SilentlyContinue |
                Select-Object -First 1) {
                [void]$projectDirs.Add($dir)
                break
            }
        }
    }

# ProjectsRoot itself might also be a project - check separately
foreach ($m in $markers) {
    if (Get-ChildItem -Path $ProjectsRoot -Filter $m -File -ErrorAction SilentlyContinue |
        Select-Object -First 1) {
        [void]$projectDirs.Add($ProjectsRoot)
        break
    }
}

Write-Host "Projects found: $($projectDirs.Count)" -ForegroundColor Green

$results = @()

foreach ($dir in $projectDirs) {
    $name = Split-Path $dir -Leaf
    Write-Host "==> $name  ($dir)" -ForegroundColor Yellow

    Push-Location $dir
    try {
        $out = graphify extract . --global --as $name --max-workers 8 2>&1
        $out | Out-File -FilePath $logFile -Append -Encoding ascii

        if ($InstallHooks) {
            graphify hook install 2>&1 | Out-File -FilePath $logFile -Append -Encoding ascii
        }

        $results += [pscustomobject]@{ Project = $name; Path = $dir; Status = "OK" }
    }
    catch {
        Write-Warning "FAILED: $name - $_"
        "$name FAILED: $_" | Out-File -FilePath $logFile -Append -Encoding ascii
        $results += [pscustomobject]@{ Project = $name; Path = $dir; Status = "FAILED" }
    }
    finally {
        Pop-Location
    }
}

Write-Host "`n--- Summary ---" -ForegroundColor Cyan
$results | Format-Table -AutoSize

Write-Host "`nGlobal graph contents:" -ForegroundColor Cyan
graphify global list

"=== Run finished $(Get-Date -Format u) ===" | Out-File -FilePath $logFile -Append -Encoding ascii
Write-Host "`nLog: $logFile"
