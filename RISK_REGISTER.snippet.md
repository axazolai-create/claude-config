<!--
Your RISK_REGISTER.md uses a markdown TABLE with R-NNN IDs. Preferred: run
    node add-risk.mjs path/to/RISK_REGISTER.md
which auto-detects the table + ID scheme (prefix, separator, zero-pad width), picks the next
free ID, is idempotent, and appends the row below. For a manual paste, replace R-{NEXT} with
the next free ID (e.g. R-005) and drop the row at the end of the table.
Columns assumed: | ID | Status | Severity | Area | Description | Mitigation / Fix |
-->

| R-{NEXT} | Mitigating | Medium | Tooling / GSD | GSD (`open-gsd/gsd-core`) generates a project `CLAUDE.md` (`/gsd-new-project`, plus a `/gsd-profile-user` section) in the project root or `.planning/`. Project memory outranks user memory and CLAUDE.md loads as context, not enforced config, so a generated file can silently override curated rules. | Cross-platform PreToolUse Node hook `deny-curated-claude-md.mjs` blocks Edit/Write to `~/.claude/CLAUDE.md` and any CLAUDE.md carrying the `CURATED:NOEDIT` marker (root or `.planning/`); unmarked generated files stay editable. Optional per-project `claudeMdExcludes: ["**/.planning/CLAUDE.md"]` when `.planning/CLAUDE.md` is GSD-owned; weighted `@import` for precedence. Hooks fire only inside Claude Code sessions (residual). |
