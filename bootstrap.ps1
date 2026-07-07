#Requires -Version 5.1
# Bootstrap installer for the curated ~/.claude config (Windows).
# Fetches the package tarball (no git needed) and runs setup.mjs.
#   irm https://raw.githubusercontent.com/axazolai-create/claude-config/master/bootstrap.ps1 | iex
#   $env:CLAUDE_CONFIG_REF='v1.0.0'; irm .../bootstrap.ps1 | iex     # pin to a release tag
#   $env:CLAUDE_SETUP_ARGS='--replace-all'; irm .../bootstrap.ps1 | iex   # forward flags to setup.mjs
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'axazolai-create/claude-config'
$Ref  = if ($env:CLAUDE_CONFIG_REF) { $env:CLAUDE_CONFIG_REF } else { 'master' }
$SetupArgs = if ($env:CLAUDE_SETUP_ARGS) { $env:CLAUDE_SETUP_ARGS -split '\s+' } else { @() }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "bootstrap: 'node' not found. Install Node.js (>=18): https://nodejs.org"
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  throw "bootstrap: 'tar' not found. Requires Windows 10 1803+ (bsdtar) or install tar."
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('claude-config-' + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $archive = Join-Path $tmp 'pkg.tar.gz'
  $url = "https://github.com/$Repo/archive/$Ref.tar.gz"
  Write-Host "bootstrap: downloading $Repo@$Ref ..."
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  tar -xzf $archive -C $tmp --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "bootstrap: tar extraction failed (exit $LASTEXITCODE) - corrupt download or bad ref '$Ref'?" }
  Remove-Item $archive -Force

  $setup = Join-Path $tmp 'setup.mjs'
  if (-not (Test-Path $setup)) {
    throw "bootstrap: setup.mjs not found in archive (bad ref '$Ref'?)."
  }
  Write-Host 'bootstrap: running setup.mjs ...'
  node $setup @SetupArgs
  Write-Host 'bootstrap: done. Restart Claude Code to load hooks & settings.'
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
