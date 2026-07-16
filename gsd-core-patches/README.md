# gsd-core hand-patches

`gsd-core` (`~/.claude/gsd-core`) is a separate tool this bundle does not own — it updates via
its own release cycle (`/gsd-update`), not via `setup.mjs`. Occasionally a real, confirmed
upstream fix lands in `gsd-core`'s own repo before it reaches a tagged release most installs
have picked up. This directory holds hand-applied backports of exactly that kind of fix,
applied automatically by `setup.mjs`, safely, without waiting for the next `gsd-core` release.

Each backport is its own subdirectory (e.g. `2285/`), independent of the others.

## Layout

```
gsd-core-patches/
  <name>/
    manifest.json
    after/
      <same relative paths as inside ~/.claude/gsd-core>
```

`manifest.json` shape:

```json
{
  "issue": 2285,
  "targetVersion": "1.7.0",
  "files": [
    { "rel": "bin/lib/some-file.cjs", "beforeSha256": "...", "afterSha256": "..." }
  ]
}
```

- `targetVersion` — the exact `gsd-core/VERSION` string the `after/` fixtures were captured
  against. `setup.mjs` only touches a machine whose installed version matches this exactly —
  a different version means either the fix already shipped upstream (nothing to do) or the
  local file layout doesn't match what this patch expects (unsafe to blind-overwrite).
- `beforeSha256` / `afterSha256` — sha256 of the file's *string content* (`readFileSync(...,
  "utf8")`, not raw bytes) before and after the patch. `setup.mjs` only overwrites a file whose
  current hash matches `beforeSha256` (apply) or `afterSha256` (already applied — no-op);
  anything else is left untouched and reported as diverged, never guessed at.
- `after/<rel>` — the complete patched file content to write, verbatim.

## How `setup.mjs` applies these

On every run, for each subdirectory here: read its `manifest.json`, compare
`~/.claude/gsd-core/VERSION` to `targetVersion` (skip silently on mismatch — this is not a
per-session nag, just a one-line summary entry), then per file compare the live hash against
`beforeSha256`/`afterSha256` and act accordingly. The original file is backed up alongside
itself with a `.pre-<name>` suffix before the first overwrite. Idempotent: re-running
`setup.mjs` after a patch has already landed reports "unchanged (already applied)".

## Retiring a backport

Once the real fix ships in a `gsd-core` release most installs have picked up (check
`~/.claude/gsd-core/VERSION` after a `/gsd-update`), delete that subdirectory entirely — the
official version supersedes the hand-applied one, and there's nothing left for `setup.mjs` to
gate on. Don't leave a stale subdirectory around "just in case"; a mismatched `targetVersion`
already makes it inert, but a dead directory here is still one more thing a future reader has
to figure out isn't relevant anymore.

## Adding a new backport

1. Apply the upstream fix by hand to a local `~/.claude/gsd-core` install, verify it works.
2. For each file touched, compute `sha256(readFileSync(file, "utf8"))` for both the original
   (pre-patch, from a fresh/known-unpatched install of the same version) and patched content.
3. Copy the patched file content into `gsd-core-patches/<name>/after/<same relative path>`.
4. Write `gsd-core-patches/<name>/manifest.json` per the shape above.
5. That's it — `setup.mjs`'s patch step is generic over every subdirectory found here, so a
   new backport needs no change there at all.
