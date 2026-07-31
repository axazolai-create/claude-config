# Paths a session may not destroy — design

Date: 2026-07-31
Status: approved, not yet planned

A `.protected` file, in `.gitignore` format, names files and folders that may not be edited,
deleted or moved. Reading and copying **from** them stays allowed. Enforcement is a
`PreToolUse` hook, never prose: the user's own global `CLAUDE.md` reserves invariants for
hooks and managed policy precisely because any project file can soft-override text.

## Context

This tree already protects one thing by hook — `deny-curated-claude-md.mjs` blocks writes to
any `CLAUDE.md` carrying a `CURATED:NOEDIT` line. That mechanism is narrow by design: one
filename, one marker, editing only. What it cannot express is "this directory of specs must
survive the session", and it cannot see deletion or a move at all, because those go through
`Bash` where the command is arbitrary text rather than a `file_path` field.

The requirements were specified by the user during phase 09 and are settled; this document
adds only what that specification left open, plus the consequences of the two answers.

## Settled before this phase, and not to be re-decided

- `.protected` is in `.gitignore` format and lists paths that may not be **edited, deleted or
  moved**. Copying them is allowed.
- It binds at its own directory level and every level below.
- A `.protected` lower down may **extend or override** what it inherits. The consequence was
  put to the user and accepted: an agent forbidden to edit a file can create a `.protected`
  beside it and permit itself.
- `.protected` may **not** be listed in `.gitignore`. A protection that exists on one machine
  is not a project rule.
- `.protected` itself may not be deleted or moved but may be edited, and that rule is
  **intrinsic** rather than a list entry — listing it would forbid nothing (editing is
  allowed) and would create a second source of truth that a nested `!` could appear to negate.
- Bash enforcement denies anything **suspicious** rather than matching exactly. A false
  positive costs a rephrase; a silently lost file cannot be undone. The asymmetry is the
  reason.
- Proposing that something be added to the list is expected during ordinary work. Proposing,
  not doing.

## Answered here

**`cp` is judged by direction, and an unparseable `cp` is denied.** The destination is the
last operand, or the argument of `-t` / `--target-directory`. A protected destination is
denied; a protected source alone is allowed. When the command cannot be parsed — a
substitution, a glob, a pipe — and a protected path appears anywhere in it, it is denied. That
is the "deny anything suspicious" rule applied where it matters most: the protection would
otherwise switch itself off exactly when the command is hardest to read.

```
cp secrets.md /tmp/           allow   source protected, destination is not
cp draft.md docs/spec.md      deny    destination protected
cp -t docs/ a b               deny    -t names the destination
cp $SRC docs/$N               deny    unparseable, and a protected path is mentioned
cp a.md b.md                  allow   no protected path involved
```

**One denial text, whatever the hook knew.** The user chose a single message over one that
distinguishes an exact match from a suspicion:

```
Denied: docs/spec.md is protected.
Rule: .protected:4  `docs/spec.md`
Protected paths may be read and copied FROM, never edited, deleted or moved.
```

Two lines are appended when they apply: that the command could not be parsed and should be
rephrased with literal paths, and that `.protected` is hidden by `.gitignore` (below).

**A hidden `.protected` denies everything in its scope.** If `.gitignore` would hide a
`.protected`, the mechanism is not a project rule at all, and the user chose to treat that as
broken rather than to warn: every write under that file's directory is denied until it is
fixed. The alternative — a warning — has no channel, because a `PreToolUse` hook that exits 0
writes stderr nobody is shown.

**Two paths stay open in the broken mode**, or the mechanism locks its own repair: fixing it
means editing `.gitignore`, which is itself a write in the denied scope. Any file named
`.gitignore`, and any file named `.protected`, is therefore writable regardless of the broken
mode — deleting either remains denied. This is a consequence of the ruling above rather than a
separate decision, and it is the one exception in the design.

"Every write" here means what the hook intercepts and nothing more: `Edit`, `Write`,
`MultiEdit`, `NotebookEdit`, and a `Bash` command judged destructive by the list below. Reads
are unaffected in the broken mode exactly as they are normally.

## How the list is assembled

For a target path, every `.protected` from the project root down its own chain of directories
is read — for `a/b/c.txt` that is `.protected`, `a/.protected`, `a/b/.protected` — and the
rules are concatenated in that order. **The last matching rule wins**, exactly as in
`.gitignore`. That single rule delivers "extend or override" without a second mechanism: a
nested file's `!docs/spec.md` comes later in the list and therefore beats an ancestor's
`docs/spec.md`.

Supported syntax is a subset of `.gitignore`: `#` comments, `!` negation, a leading `/`
anchoring to the directory of the file that declared the rule, `*`, `?`, `**`, character
classes, and a trailing `/` meaning "directory only". The matcher is written here, about forty
lines: the bundle has no dependencies, and shelling out to `git check-ignore` is not available
either — the suite asserts that no hook spawns a subprocess.

## What the hook intercepts

Registered on `Edit|Write|MultiEdit|NotebookEdit|Bash`.

The first four carry a path as a field and are judged exactly. `Bash` is heuristic. Verbs
treated as destructive: `rm`, `mv`, `git rm`, `git mv`, `truncate`, `dd`, `sed -i`, `find`
with `-delete` or `-exec rm`, `tar`/`unzip` extracting into a directory, and `>` / `>>`
redirection. Reads — `cat`, `grep`, `less`, `head` — are never touched, so the common case
stays out of the way.

## Failure is an allow, except where it is a deny

Two different failures, deliberately resolved in opposite directions:

- **The hook cannot understand its own input** — malformed JSON on stdin, a payload that is
  not an object, a missing field. It exits 0 and allows. A guard mechanism that breaks the
  session when its input surprises it is worse than one that misses a case. The literal
  `null` payload is handled explicitly (`JSON.parse("null")` returns `null`, and the property
  access after it throws) — the defect filed as `RISK-HOOKSTDIN-001`, which a sweep during
  this design found unguarded in 14 of the 16 hooks that parse stdin.
- **The hook understands the input but cannot resolve the command** — it denies, per the
  ruling above.

## Testing decisions

- **The decision is verified as a pure function**: rules plus an operation in, verdict and
  message out, with no filesystem. Every case in the `cp` table above, the last-match-wins
  precedence, the intrinsic `.protected` rule, and the broken mode with its two exceptions.
- **Assembly is verified on a fixture tree** in a temp directory: inheritance down the chain,
  a nested file overriding an ancestor, and a `.gitignore` that hides a `.protected`.
- **The hook is verified end to end** by feeding it JSON on stdin and asserting `exit 2` with
  the message on stderr, and `exit 0` for reads and for malformed input. It must also satisfy
  the existing suite-wide assertion that no hook spawns a subprocess.

## Risks

- **The escape hatch is real and was accepted.** A nested `.protected` can unprotect anything.
  Worth an entry in the register during the phase, because the mechanism reads as stronger
  than it is.
- **TOCTOU on symlinks.** The path is resolved before the verdict; a symlink swapped between
  the check and the write defeats it. Out of scope to fix, in scope to state.
- **Heuristic Bash matching will produce false positives.** That is the chosen trade; the
  denial message carries the rephrase hint for exactly this reason.

## Out of scope

- MCP write tools: a different input contract, and no evidence yet of which ones matter.
- Anything outside a Claude Code session — the hook cannot see an editor or a shell the user
  runs themselves, and the protection is not a filesystem ACL.
- Repairing `RISK-HOOKSTDIN-001` in the other 13 hooks. This phase guards its own hook and
  records the sweep; fixing the rest is its own change with its own review.

## Depends on

- `settings.partial.json` registration reaching machines through `setup.mjs`, as every other
  hook does.
- The `PreToolUse` contract already used by `deny-curated-claude-md.mjs`: exit 2 denies and
  feeds stderr back, exit 0 allows.
