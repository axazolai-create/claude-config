# Risk Register

## RISK-BOOTSTRAP-001 — Remote code execution via `curl|bash` / `irm|iex` bootstrap

- **Status:** Open (accepted)
- **Context:** `bootstrap.sh`/`bootstrap.ps1` are executed straight from the network, and they
  download+run `setup.mjs` from a GitHub tarball. A compromised repo, MITM, or wrong ref runs
  arbitrary code on the new machine.
- **Mitigation:** HTTPS-only endpoints; pin to a signed release tag via `--ref v1.0.0` for
  reproducibility; documented safe alternative (download → inspect → run) in README; secrets
  never embedded in bootstrap scripts.
- **Residual:** Standard installer trust model — user must trust the repo owner. Accepted.

## RISK-STACKRULES-001 — Model-driven rules compilation can lose requirements

- **Status:** Open (accepted)
- **Context:** `.claude/stack-rules.md` is compiled from `~/.claude/rules-src/` by a subagent
  (deduplicated rewrite, not a mechanical concatenation — per user decision 2026-07-12). A
  careless build could drop or distort a rule requirement, and the loss would persist until
  the next rebuild.
- **Mitigation:** compiler instructions (`rules-src/README.md` § "Building stack-rules")
  require every "Avoid:" list and every version pin to be carried over verbatim; the snapshot
  frontmatter marks it machine-owned so fixes go into `rules-src/` (source of truth) and a
  rebuild is idempotent; the snapshot is a reviewable file, not hidden state.
- **Residual:** prose-level nuance can still be lossy between rebuilds. Accepted.

## RISK-STACKRULES-002 — Snapshot desync / stale auto-loading copies

- **Status:** Open (accepted)
- **Context:** two desync paths. (1) `stack-rules-check.mjs` hashes source rules by
  path+size+mtime — a change that preserves all three (e.g. a restore that keeps mtimes) is
  invisible, leaving a stale snapshot with no rebuild note. (2) A machine that updates the
  bundle but never re-runs `setup.mjs` keeps the old auto-loaded `~/.claude/rules/` copies
  alongside the snapshot — every rule then loads twice.
- **Mitigation:** (1) any normal edit or `setup.mjs` deploy changes size/mtime; a manual
  rebuild can always be requested. (2) `setup.mjs` `migrateRulesDir()` deletes bundle-owned
  files from `~/.claude/rules/` and removes the directory when empty; user-authored files
  are kept and reported with a move-by-hand note.
- **Residual:** machines that skip `setup.mjs` after upgrading stay on the old (working)
  mechanism until they run it. Accepted.

## RISK-CLAUDEMD-001 — Legacy `@.claude/CLAUDE.md` imports double-load project context

- **Status:** Open (accepted, manual cleanup)
- **Context:** the removed session-init link-import step (deleted 2026-07-12) used to prepend
  `@.claude/CLAUDE.md` to a project's root `CLAUDE.md`. Claude Code auto-loads
  `<project>/.claude/CLAUDE.md` by itself (doc-verified + live-tested 2026-07-12), so any
  project still carrying that line loads the generated file twice per session.
- **Mitigation:** no hook can fix it (root `CLAUDE.md` is usually `CURATED:NOEDIT`, and the
  deny hook rightly blocks writes). Remove the `@.claude/CLAUDE.md` line by hand when
  touching an affected project's root `CLAUDE.md`.
- **Residual:** duplicated context in affected projects until manually cleaned. Accepted.

## RISK-TOKENLOG-001 — Scraped model pricing can silently break

- **Status:** Open (accepted)
- **Context:** `hooks/lib/token-usage-pricing-refresh.mjs` estimates `cost_usd` in the
  token-usage log by scraping `docs.claude.com/en/docs/about-claude/pricing`'s HTML pricing
  table. There is no official Anthropic pricing API — this is regex-based HTML parsing against a
  page Anthropic doesn't version or contract to keep stable. If the page's markup structure
  changes, parsing can silently return zero or partial rows.
- **Mitigation:** a `MIN_EXPECTED_MODELS` guard (currently 8) rejects a suspiciously small parse
  result and leaves the existing `~/.claude/state/model-pricing.json` untouched rather than
  overwriting it with bad data; `token-usage-log.mjs` surfaces a `systemMessage` warning when the
  pricing file is more than 48h stale. Refresh is throttled to once/24h and fully optional
  (`CLAUDE_TOKEN_USAGE_COST=0` disables cost estimation and the refresh job entirely, leaving raw
  token counts only).
- **Residual:** `cost_usd` is always a **best-effort local estimate**, never billing-grade — same
  disclaimer Claude Code's own `/usage` command carries for its dollar figure. Accepted.
