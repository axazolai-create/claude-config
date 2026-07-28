# measure-context.ps1 (v2) -- measure real context window usage from Claude Code transcripts.
#
# ASCII only by design: Windows PowerShell 5.1 reads .ps1 files in the console
# codepage (cp1251 on a Russian system) unless the file is UTF-8 with BOM.
#
# Method: window occupancy per assistant turn =
#     input_tokens + cache_read_input_tokens + cache_creation_input_tokens
# taken from the usage block of assistant entries. Computed locally, no model calls.
#
# WHAT v2 FIXES (v1 reported nonsense like "260% of 200k"):
#   1. Subagent turns are excluded. Claude Code writes subagent (Agent tool)
#      turns into the SAME transcript, marked isSidechain=true. They have their
#      own separate context, so mixing them with the main thread inflates the
#      peak and produces meaningless deltas. Use -IncludeSidechains to see them.
#   2. Context resets are detected. /compact and /clear drop occupancy back down;
#      one "peak" for the whole file is wrong. The run is split into segments at
#      each large drop and reported per segment.
#   3. Skill loads are reported honestly. If the transcript contains no Skill
#      calls at all, the script says so instead of silently printing nothing.
#
# Usage:
#   .\measure-context.ps1 -List             # list transcripts, then pick one
#   .\measure-context.ps1                   # most recent transcript
#   .\measure-context.ps1 -File <name.jsonl>
#   .\measure-context.ps1 -All
#   .\measure-context.ps1 -Csv out.csv
#   .\measure-context.ps1 -WindowSize 500000
#
# Reading the output: a Delta on a turn that called Skill is the cost of that
# skill body. Compare the per-phase Skill total against the ~23,900 estimate.
# Large deltas with an empty Tools column are tool RESULTS and conversation
# content arriving from the previous turn -- the work itself, not the framework.

param(
    [switch]$All,
    [switch]$List,
    [switch]$IncludeSidechains,
    [string]$File,
    [int]$Top = 20,
    [int]$WindowSize = 200000,
    [int]$ResetThreshold = 30000,
    [string]$Csv,
    [string]$ProjectsDir = "$env:USERPROFILE\.claude\projects"
)

$ErrorActionPreference = 'Stop'

function AsInt($v) { if ($null -eq $v) { return 0 } try { return [int]$v } catch { return 0 } }

if (-not (Test-Path $ProjectsDir)) {
    Write-Host "Transcript directory not found: $ProjectsDir" -ForegroundColor Yellow
    Write-Host 'Locate it manually: Get-ChildItem "$env:USERPROFILE\.claude" -Directory'
    exit 1
}

$files = Get-ChildItem $ProjectsDir -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending

if (-not $files) {
    Write-Host "No .jsonl transcripts found under $ProjectsDir" -ForegroundColor Yellow
    exit 1
}

if ($List) {
    Write-Host ""
    Write-Host "Available transcripts (newest first):" -ForegroundColor Cyan
    $files | Select-Object -First 40 |
        Format-Table @{N='Modified';E={$_.LastWriteTime}},
                     @{N='SizeKB';E={[math]::Round($_.Length/1KB)}},
                     @{N='Project';E={Split-Path $_.DirectoryName -Leaf}},
                     Name -AutoSize
    Write-Host "Pick one with: .\measure-context.ps1 -File <Name>" -ForegroundColor DarkGray
    exit 0
}

if ($File) { $files = $files | Where-Object { $_.Name -eq $File } }
elseif (-not $All) { $files = $files | Select-Object -First 1 }

if (-not $files) { Write-Host "No matching transcript." -ForegroundColor Yellow; exit 1 }

$allRows = @()

foreach ($f in $files) {
    Write-Host ""
    Write-Host ("=" * 78)
    Write-Host "File    : $($f.Name)"
    Write-Host "Project : $(Split-Path $f.DirectoryName -Leaf)"
    Write-Host "Modified: $($f.LastWriteTime)"
    Write-Host ("=" * 78)

    $rows = @()
    $turn = 0
    $skipped = 0

    foreach ($line in [System.IO.File]::ReadLines($f.FullName)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        try { $e = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if ($e.type -ne 'assistant') { continue }

        $isSide = $false
        if ($null -ne $e.isSidechain) { $isSide = [bool]$e.isSidechain }
        if ($isSide -and -not $IncludeSidechains) { $skipped++; continue }

        $u = $e.message.usage
        if (-not $u) { continue }

        $turn++

        $inp   = AsInt $u.input_tokens
        $cRead = AsInt $u.cache_read_input_tokens
        $cCrea = AsInt $u.cache_creation_input_tokens
        $out   = AsInt $u.output_tokens
        $total = $inp + $cRead + $cCrea

        $tools = @()
        foreach ($c in $e.message.content) {
            if ($c.type -eq 'tool_use') {
                $n = $c.name
                if ($n -eq 'Skill' -and $c.input.command) { $n = "Skill:$($c.input.command)" }
                $tools += $n
            }
        }

        $rows += [pscustomobject]@{
            File    = $f.Name
            Turn    = $turn
            Segment = 1
            Input   = $inp
            CacheR  = $cRead
            CacheW  = $cCrea
            Output  = $out
            Total   = $total
            Delta   = 0
            Side    = $isSide
            Tools   = ($tools -join ',')
        }
    }

    if ($rows.Count -eq 0) {
        Write-Host "No usable assistant turns with usage data." -ForegroundColor Yellow
        continue
    }

    $seg = 1
    for ($i = 1; $i -lt $rows.Count; $i++) {
        $d = $rows[$i].Total - $rows[$i - 1].Total
        if ($d -lt (-1 * $ResetThreshold)) { $seg++; $rows[$i].Delta = 0 }
        else { $rows[$i].Delta = $d }
        $rows[$i].Segment = $seg
    }

    if ($skipped -gt 0) {
        Write-Host "Subagent turns excluded : $skipped (use -IncludeSidechains to show)" -ForegroundColor DarkGray
    }
    Write-Host "Main-thread turns       : $($rows.Count)"
    Write-Host "Context segments        : $seg  (each reset = /compact or /clear)"
    Write-Host ""

    $segStats = $rows | Group-Object Segment | ForEach-Object {
        $p = ($_.Group | Measure-Object -Property Total -Maximum).Maximum
        [pscustomobject]@{
            Segment  = [int]$_.Name
            Turns    = $_.Count
            PeakTok  = $p
            PctOfWin = [math]::Round($p / $WindowSize * 100, 1)
            EndTok   = $_.Group[-1].Total
        }
    }
    Write-Host "Per-segment peak occupancy:" -ForegroundColor Cyan
    $segStats | Format-Table -AutoSize

    $worst = ($segStats | Measure-Object -Property PctOfWin -Maximum).Maximum
    if ($worst -gt 100) {
        Write-Host "NOTE: a segment exceeds 100% of the assumed $WindowSize window." -ForegroundColor Yellow
        Write-Host "      Either the model has a larger window (pass -WindowSize), or this" -ForegroundColor Yellow
        Write-Host "      transcript interleaves contexts the script could not separate." -ForegroundColor Yellow
    }

    $skillRows = $rows | Where-Object { $_.Tools -like '*Skill*' }
    Write-Host ""
    if (-not $skillRows) {
        Write-Host "No Skill calls in this transcript -- nothing to compare against the" -ForegroundColor Yellow
        Write-Host "23,900 estimate. Run this against a session where Superpowers skills fired." -ForegroundColor Yellow
    }
    else {
        $skillSum = ($skillRows | Where-Object { $_.Delta -gt 0 } | Measure-Object -Property Delta -Sum).Sum
        Write-Host "Skill calls: $($skillRows.Count) turns, delta total $skillSum tokens" -ForegroundColor Green
        $skillRows | Sort-Object Turn | Format-Table Turn, Segment, Delta, Total, Tools -AutoSize
    }

    Write-Host "Largest jumps overall:" -ForegroundColor Cyan
    $rows | Sort-Object Delta -Descending | Select-Object -First $Top |
        Sort-Object Turn | Format-Table Turn, Segment, Delta, Total, Tools -AutoSize

    $allRows += $rows
}

if ($Csv -and $allRows.Count -gt 0) {
    $allRows | Export-Csv -Path $Csv -NoTypeInformation -Encoding UTF8
    Write-Host ""
    Write-Host "Per-turn rows written to: $Csv" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Empty Tools on a large jump = tool results and conversation content," -ForegroundColor DarkGray
Write-Host "i.e. the work itself, not framework overhead." -ForegroundColor DarkGray
