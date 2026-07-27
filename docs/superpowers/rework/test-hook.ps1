# test-hook.ps1 (v2) -- self-contained test for pre-task-blockedby-enforce.mjs
#
# ASCII only (cp1251 safety). Runs in seconds. No Claude Code session needed.
#
# v2 fixes a harness bug, not a hook bug: PowerShell 5.1 turns a native
# command's stderr into an ErrorRecord, and with $ErrorActionPreference='Stop'
# that became a terminating error the moment the hook correctly refused a task.
# The hook was working; the test was not. Now stderr is merged and inspected
# instead of thrown, and console decoding is set to UTF-8 so the hook's Russian
# messages stay readable if a check fails.
#
# What it does: builds a throwaway task store under $env:TEMP, feeds the hook
# synthetic PreToolUse payloads, and checks exit codes. Nothing outside the
# temp directory is touched; your real ~/.claude is never read or written.
#
# Usage (from the folder holding the .mjs):
#   .\test-hook.ps1
#   .\test-hook.ps1 -NodeExe "C:\Program Files\nodejs\node.exe"
#   .\test-hook.ps1 -Verbose      # show hook output for every check
#
# Exit code 0 = all passed, 1 = something failed.

[CmdletBinding()]
param(
    [string]$Hook = ".\pre-task-blockedby-enforce.mjs",
    [string]$NodeExe = "node"
)

# Native stderr must NOT be fatal here -- the hook writes to stderr by design.
$ErrorActionPreference = 'Continue'

# Decode native output as UTF-8 so the hook's messages are readable.
$prevEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$script:pass = 0
$script:fail = 0
$script:failed = @()

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

if (-not (Test-Path $Hook)) {
    Say "Hook file not found: $Hook" Red
    Say "Run this from the folder containing pre-task-blockedby-enforce.mjs" Yellow
    exit 1
}
$HookFull = (Resolve-Path $Hook).Path

$nodeOk = $false
if (Test-Path $NodeExe) { $nodeOk = $true }
elseif (Get-Command $NodeExe -ErrorAction SilentlyContinue) { $nodeOk = $true }
if (-not $nodeOk) {
    Say "Cannot find node: $NodeExe" Red
    Say 'Try: .\test-hook.ps1 -NodeExe "C:\Program Files\nodejs\node.exe"' Yellow
    exit 1
}

# --- throwaway environment -------------------------------------------------
$root  = Join-Path $env:TEMP ("hooktest-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$tasks = Join-Path $root ".claude\tasks"
$projA = Join-Path $tasks "projA"
$projB = Join-Path $tasks "projB"
$work  = Join-Path $root "work"
New-Item -ItemType Directory -Force -Path $projA, $projB, (Join-Path $work ".claude") | Out-Null

function WriteTask($dir, $id, $subject, $status, $blockedBy) {
    $bb = ""
    if ($blockedBy -and $blockedBy.Count -gt 0) { $bb = '"' + ($blockedBy -join '","') + '"' }
    $json = '{"id":"' + $id + '","subject":"' + $subject + '","status":"' + $status +
            '","blocks":[],"blockedBy":[' + $bb + ']}'
    Set-Content -Path (Join-Path $dir "$id.json") -Value $json -Encoding ascii -NoNewline
}

WriteTask $projA 1 "A-blocker" "pending" @()
WriteTask $projA 2 "B-target"  "pending" @("1")
Start-Sleep -Milliseconds 1100
WriteTask $projB 2 "OTHER-PROJECT" "pending" @()

$savedProfile = $env:USERPROFILE
$savedListId  = $env:CLAUDE_CODE_TASK_LIST_ID
$savedGuard   = $env:BLOCKEDBY_GUARD
$savedTrace   = $env:GATE_TRACE_LOG
$env:USERPROFILE = $root
# Keep the test's own trace inside the sandbox: otherwise these 14 runs land in
# the shared %TEMP%\claude-hooks\gate-trace.log and make it look like the hook
# fired in a real Claude Code session when it did not.
$env:GATE_TRACE_LOG = Join-Path $root "trace\test-trace.log"
Remove-Item env:CLAUDE_CODE_TASK_LIST_ID -ErrorAction SilentlyContinue
Remove-Item env:BLOCKEDBY_GUARD -ErrorAction SilentlyContinue

# Everything below runs inside try/finally so the environment and the temp
# directory are restored on any exit path, including an error or Ctrl+C.
# v1 lacked this: an aborted run left $env:USERPROFILE pointing at the sandbox,
# after which every command using $env:USERPROFILE in that window looked in the
# wrong place -- and nothing said so.
function RunCase {
    param([string]$Name, [string]$Payload, [int]$Expect, [hashtable]$Env = @{})

    foreach ($k in $Env.Keys) { Set-Item -Path "env:$k" -Value $Env[$k] }

    $global:LASTEXITCODE = 0
    # 2>&1 merges stderr into the output stream as records; with
    # ErrorActionPreference=Continue they are collected, not thrown.
    $out = $Payload | & $NodeExe $HookFull 2>&1 | Out-String
    $code = $LASTEXITCODE

    foreach ($k in $Env.Keys) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue }

    if ($code -eq $Expect) {
        $script:pass++
        Say ("  PASS  {0,-44} exit={1}" -f $Name, $code) Green
        if ($PSBoundParameters.Verbose -or $VerbosePreference -eq 'Continue') {
            if ($out.Trim()) { Say ("        " + ($out.Trim() -replace "`r?`n", "`n        ")) DarkGray }
        }
    } else {
        $script:fail++
        $script:failed += $Name
        Say ("  FAIL  {0,-44} exit={1} expected={2}" -f $Name, $code, $Expect) Red
        if ($out.Trim()) { Say ("        " + ($out.Trim() -replace "`r?`n", "`n        ")) DarkGray }
    }
}

function P($taskId, $cwd) {
    $c = ""
    if ($cwd) { $c = ',"cwd":"' + ($cwd -replace '\\','\\\\') + '"' }
    '{"tool_name":"TaskUpdate"' + $c + ',"tool_input":{"taskId":"' + $taskId + '","status":"in_progress"}}'
}

try {

Say ""
Say "Hook    : $HookFull" Cyan
Say "Node    : $NodeExe" Cyan
Say "Sandbox : $root" Cyan
Say ""
Say "Enforcement" Cyan

RunCase "blocked task refused" (P 2 $work) 2 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

WriteTask $projA 1 "A-blocker" "completed" @()
RunCase "blocker completed -> allowed" (P 2 $work) 0 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

WriteTask $projA 1 "A-blocker" "cancelled" @()
RunCase "blocker cancelled -> allowed" (P 2 $work) 0 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

WriteTask $projA 1 "A-blocker" "pending" @()
RunCase "blocker pending again -> refused" (P 2 $work) 2 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

Say ""
Say "Project isolation (second project on the same machine)" Cyan

RunCase "no list id -> passes, does not guess" (P 2 $work) 0

Set-Content -Path (Join-Path $work ".claude\task-list-id") -Value "projA" -Encoding ascii -NoNewline
RunCase "marker file resolves own list" (P 2 $work) 2

RunCase "env var overrides marker" (P 2 $work) 0 @{ CLAUDE_CODE_TASK_LIST_ID = "projB" }

Remove-Item (Join-Path $work ".claude\task-list-id") -Force -ErrorAction SilentlyContinue
RunCase "no cwd, no env -> passes safely" (P 2 $null) 0

Say ""
Say "Safety" Cyan

RunCase "path traversal rejected" (P 2 $work) 0 @{ CLAUDE_CODE_TASK_LIST_ID = "../../evil" }
RunCase "unrelated tool ignored" '{"tool_name":"Bash","tool_input":{}}' 0
RunCase "status=completed ignored" '{"tool_name":"TaskUpdate","tool_input":{"taskId":"2","status":"completed"}}' 0 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

Set-Content -Path (Join-Path $work ".claude\task-list-id") -Value "projA" -Encoding ascii -NoNewline
RunCase "kill switch disables guard" (P 2 $work) 0 @{ BLOCKEDBY_GUARD = "0" }
RunCase "malformed stdin -> fail-open" 'not json at all' 0
RunCase "unknown task id -> fail-open" (P 99 $work) 0 @{ CLAUDE_CODE_TASK_LIST_ID = "projA" }

}
finally {
    # --- cleanup: always runs, including on error or interrupt --------------
    $env:USERPROFILE = $savedProfile
    if ($savedListId) { $env:CLAUDE_CODE_TASK_LIST_ID = $savedListId } else { Remove-Item env:CLAUDE_CODE_TASK_LIST_ID -ErrorAction SilentlyContinue }
    if ($savedGuard)  { $env:BLOCKEDBY_GUARD = $savedGuard }            else { Remove-Item env:BLOCKEDBY_GUARD -ErrorAction SilentlyContinue }
    if ($savedTrace)  { $env:GATE_TRACE_LOG = $savedTrace }             else { Remove-Item env:GATE_TRACE_LOG -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
    try { [Console]::OutputEncoding = $prevEnc } catch { }
}

Say ""
if ($script:fail -eq 0) {
    Say "ALL $($script:pass) CHECKS PASSED" Green
    Say ""
    Say "Not covered by this test: the payload shape Claude Code actually sends." DarkGray
    Say "To check that in ~30 seconds, in a real session run:" DarkGray
    Say '  $env:GATE_DEBUG_PAYLOAD = "1"' DarkGray
    Say "trigger any TaskUpdate, then inspect:" DarkGray
    Say '  Get-Content "$env:TEMP\claude-hooks\payload-sample.json" -Tail 1' DarkGray
    Say "Look for a cwd field. If absent, always set CLAUDE_CODE_TASK_LIST_ID." DarkGray
    exit 0
} else {
    Say "$($script:fail) CHECK(S) FAILED, $($script:pass) passed" Red
    foreach ($n in $script:failed) { Say "  - $n" Red }
    exit 1
}
