# Orphaned reports

Four implementer reports rescued from `.superpowers/sdd/` when that scratch tree was folded into
phase summaries on 2026-07-29 and deleted.

Each belongs to work whose SDD workspace had already been cleaned up, or which reused another
plan's directory, leaving these files behind with no ledger and no phase of their own:

| File | Work it documents |
|---|---|
| `2026-csharp-stack-support-final-review-fix-report.md` | `csharp-stack-support` — final-review fix wave |
| `2026-lite-variant-final-review-fix-wave-report.md` | `feat/lite-variant` — final-review fix wave |
| `2026-bootstrap-hardening-task-6h-report.md` | pre-release hardening: `.gitattributes`, `bootstrap.sh`/`bootstrap.ps1` env-var parity, a shellcheck CI workflow |
| `2026-post-v1.0.0-followups-task-fu-report.md` | three post-v1.0.0 follow-ups |

The last two sat inside `archive-graphify-neo4j/` and were found by the summary writer folding that
phase: their commits (`354b160`, `518bd2f`, `8510d23`, `9380b6e`) appear nowhere in that phase's
ledger. Directory-name reuse across plan runs is what put them there.

They are kept verbatim rather than folded, because inventing phase directories for work that never
had them would fabricate a history that did not happen — the same reason the historic plans and
specs beside them moved across unretrofitted.

They are kept **at all** because the deletion they were rescued from was justified by a rule they
do not satisfy: everything else in that scratch was either a diff `git diff` reproduces exactly or
a brief `scripts/task-brief` regenerates. An implementer report is neither. Git holds the commits;
it does not hold what was wrong, what was tried and abandoned, or why.
