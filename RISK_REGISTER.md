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
