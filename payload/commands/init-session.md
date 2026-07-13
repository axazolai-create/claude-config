---
description: Apply pending content patches to ~/.claude/agents/gsd-*.md (context-mode routing guidance, gsd-executor.md/gsd-debugger.md hardening fixes)
allowed-tools: Bash(node *)
---

Applies the patch registry in `~/.claude/hooks/lib/gsd-agent-patches.mjs` to
`~/.claude/agents/gsd-*.md`. These files are owned by the separate `gsd-core` tool, not this
bundle - this command is best-effort cross-tool maintenance, review-gated on purpose (unlike
the silent per-session context-mode tool-grant sync) because it injects prose across 30+
files. `session-init.mjs` checks read-only every session and tells you when something here is
pending; this command is what actually writes.

## 1. Run the patcher

```bash
node ~/.claude/apply-gsd-agent-patches.mjs
```

## 2. Report

Show me exactly what it printed: which `file:patchId` pairs were applied, which files were
skipped as curated (left untouched on purpose - `CURATED:NOEDIT` marker), and which were
skipped for a missing anchor (means the target file changed upstream since this patch was
written - flag those to me explicitly, don't silently treat them as done).

## 3. If anything was skipped for a missing anchor

Read the affected file and tell me what changed near the patch's expected anchor text
(`~/.claude/hooks/lib/gsd-agent-patches.mjs` documents each patch's target string). Don't
guess a new anchor and re-apply automatically - that's a judgment call on whether the patch
still makes sense against the new content, which needs my review.
