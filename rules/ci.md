---
paths:
  - "**/.github/workflows/*.yml"
  - "**/.github/workflows/*.yaml"
---

# CI (GitHub Actions)
- Pin third-party actions by commit SHA (`uses: owner/action@<sha>`), not a mutable tag;
  first-party `actions/*` may use major-version tags (`@v4`).
- `permissions:` explicit and minimal (default `contents: read`; grant more per-job only
  where needed) — never rely on the repo-wide default.
- Cache dependencies (pnpm store, uv/pip cache, Gradle cache) keyed on the lockfile hash.
- Matrix-test supported language/runtime versions; `fail-fast: false` so one failure
  doesn't hide the others.
- Split jobs by concern (lint, typecheck, test, build) so failures are attributable; run
  them in parallel, not as one monolithic job.
- Secrets only via `secrets.*`/OIDC, never hardcoded; never echo a secret to logs (masking
  isn't guaranteed for interpolated strings).
- Prefer OIDC federation for cloud deploys over long-lived static credentials where the
  provider supports it.
- Avoid: `pull_request_target` with untrusted code checkout, mutable action tags, secrets
  interpolated into `run:` strings, skipping tests on `main` pushes.
