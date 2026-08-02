---
description: Check whether the ultrapowers fork is behind obra/superpowers, and rebuild it against a new upstream release
argument-hint: "[check|update] [--publish] [--repo owner/name]"
allowed-tools: Bash(node *), Read
---

Report the state of the `ultrapowers` fork against its upstream. Runnable from any project — this
command talks to GitHub, never to a local checkout, and writes nothing anywhere.

## Run it

```
node ~/.claude/bin/up-update.mjs check
```

Pass `$ARGUMENTS` through unchanged. `--repo owner/name` points the run at a different fork for
one invocation; there is no config file to edit and no state to clear.

## Show me the report as it is

Print the tool's output verbatim. Do not summarise the legal entries away: each one is a path
to leave alone, with its reason. If the list looks long, that is the list.

## What the statuses mean

- **up to date** — the newest upstream release is the one `main` was built from. Nothing to do.
- **BEHIND** — upstream has published a newer release. The rebuild is `/up-update update`, which
  works in a throwaway clone and either produces a publishable build or refuses and says which of
  its conditions failed. It never pushes without asking.
- **cannot tell** — a version could not be parsed, or the fork has no `upstream/*` tag recording
  which base `main` was built from. Treat this as a problem to investigate, **not** as up to date;
  the command exits non-zero for exactly this reason.
- A pre-release upstream is reported and deliberately does not count as being behind.

## Rebuilding against a new upstream release

```
node ~/.claude/bin/up-update.mjs update
```

Everything happens in a throwaway clone in a temp directory. The command either **refuses** and
says which condition fired, or **prepares the release and stops**. It refuses when:

- a delta no longer applies (named individually, with where its context went missing);
- the upstream name survives outside the one protected string;
- upstream touched more of the tracked files than the configured threshold — a rebuild that big
  deserves a human reading the diff, not a green tick;
- `main` does not match a fresh build, i.e. somebody hand-edited a generated branch;
- an upstream file is unclassified or absent from the map's manifest;
- the attribution the licence requires is missing from the built tree.

An **obsolete** delta — one whose change upstream has since made itself — is reported and does
**not** refuse. Do not drop it on your own initiative: removing a delta is a decision, and it is
made by the human, deliberately.

## Publishing is a separate, explicit act

`update` never pushes. On success it prints what it prepared and leaves the working clone on disk
for inspection. Show the human that summary and **ask**. Only if they agree, re-run with
`--publish`. Do not pass `--publish` on the first run, and do not infer approval from an earlier
"yes" to running the check.

After publishing, the new version is not on anybody's machine yet. `/up-update` releases; getting
it installed is `/plugin update`, run by the human.

## Do not

- Do not run `setup.mjs`, `claude plugin install`, or `claude plugin update` off the back of this
  report. `/up-update` publishes a new build; getting it onto this machine is a separate, deliberate
  step the human takes.
- Do not look for or read a local clone of the fork. If one exists it is a development checkout and
  has no bearing on what this command reports — that independence is the point, and quietly
  depending on it would break the command on every machine that does not have one.
