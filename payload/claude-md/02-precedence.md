---
profiles: [base, lite]
---
## PRECEDENCE & ENFORCEMENT MODEL (read first)
- This is USER scope. Project `CLAUDE.md` outranks it on conflict, and memory is loaded as
  context, not enforced config — any project file can soft-override prose here. Design
  accordingly:
  - INVARIANTS are enforced by hooks/managed policy, NOT by this prose. No project file can
    relax them. This file only documents intent.
  - Everything else — including behavioral rules that cannot be hook-gated ("don't invent
    APIs") — is a DEFAULT: advisory, a project `CLAUDE.md` may override it; treat such an
    override as intended, not a violation.
