# Versioning and changelog as a standing practice — design

Date: 2026-07-28
Status: approved, not yet planned

## Context

`update-changelog` today turns a slice of git history into `changelog.json` entries and bumps
**one patch per entry**. Three properties make it a thing you must remember to run rather than a
practice that runs itself:

- **No bump level is ever derived.** `classify-bump.mjs` does not classify a change; it compares
  two already-written versions and returns `релиз` or `патч` for the commit prefix. minor and
  major only ever appear if a human typed them.
- **No attachment to the work.** The bump happens when someone remembers to invoke the skill
  after the fact.
- **Gated to React/Next** with the `{version, changes[]}` shape, so it refuses to run on
  everything else — including this repository and the ultrapowers fork.

The monorepo mode also contradicts itself. Its opening paragraph promises that a part with no
changelog UI still shows up, abstracted, in the other parts' logs; §M3 then states there is no
cross-part fan-out and a no-home commit is dropped everywhere. The behaviour that was designed
is not the behaviour that was implemented.

## Bump levels

Derived from Conventional Commits, which the user-scope `CLAUDE.md` already mandates as the
default:

| Commit | Level |
|---|---|
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:`, `build:` | patch |
| `docs:`, `chore:`, `test:`, `style:`, `ci:` | no bump |
| `feat!:`, `BREAKING CHANGE:` in the body | **proposes major, never applies it** |

**Major is never automatic.** This deliberately departs from strict SemVer, where a breaking
change mechanically implies a major. The tool may *propose* one — on an explicit breaking marker,
or on a branch carrying many `feat:` commits — and must then stop and wait for the user. Without
approval it falls back to minor and says so. Rationale: a major is a promise to consumers, and
the cost of an unwanted one is high and effectively irreversible once published, while the cost
of waiting for a human is one question.

patch and minor apply unattended.

## When the bump happens

Classification runs **per commit** — the post-commit hook already queues every commit — and the
version moves **once per drain**, taking the maximum accumulated level. A queue holding one
`feat` and six `fix` yields a single minor, not seven bumps.

This keeps the practice continuous without making the version a commit counter.

## Scope

**Any project with a `package.json`.** The React/Next gate is dropped for versioning: it is what
excludes this repository, the fork, and every backend from having a derived version at all.

The gate stays only for **rendering** a user-facing changelog — a backend still gets versions and
still contributes entries, it simply has no UI of its own to show them in.

## Monorepo

### Versions — every level

Each workspace carries its own version, bumped from the commits that touched it. The repository
root carries one too: the maximum of the parts' bumps in this drain, combined with its own
root-level commits.

This closes today's hole where a root-level commit belongs to no workspace and is therefore
dropped entirely.

### Changelog — placement

- **No frontend part** → a single changelog at the repository root.
- **One or more frontend parts** (`detect-project.mjs` reports `isReactOrNext`) → one changelog
  **inside each frontend part**, at that part's own `changelogPath`.

### Changelog — cross-part content

Every frontend part's changelog carries, besides its own detailed entries, entries originating in
**other** parts — including other frontend parts — in reduced form.

Reduction is about **density, not wording**. The filter is relevance to *this* part's users:

- A backend's character-encoding change: omitted — invisible from this frontend.
- A new endpoint for external integrations: included — it changes what this frontend can offer.

The entry is written in the same voice as any other; it is simply chosen, not softened.

## Deterministic vs judgement

The split governs what may be automated:

| Code decides | Human or model decides |
|---|---|
| Level from the commit type | Whether a major is warranted |
| Which workspaces a commit touched | Whether another part's change is relevant here |
| Root version from parts + root commits | The Russian wording of an entry |
| Whether a frontend part exists | Whether a change is meaningful at all (§3.1) |
| Where the changelog file belongs | — |

Anything in the right column stays in `SKILL.md` as instruction. Automating it would produce
confident nonsense.

## Tooling

- `classify-bump.mjs` gains the real classifier: commit subjects and bodies in, level out, with
  major reported as a *proposal* carrying its reason.
- The post-commit hook queues the level alongside the hash it already records.
- Drain resolves the maximum, applies patch/minor, and stops for approval on a proposed major.
- A `lint` mode reports a version that has drifted from its queue, for the shared nudge hook
  described in the decision-records design.

## Risks

- Conventional Commits are a convention, not a constraint. A commit with no recognised type
  yields no bump and silently contributes nothing; `lint` must surface those rather than let them
  vanish.
- Cross-part relevance is a judgement made per entry. It will sometimes be wrong in both
  directions, and there is no test that can catch it.
- Dropping the React/Next gate means the skill now runs where it never ran before; existing
  projects must not have versions moved retroactively on first contact.

## Out of scope

- Keep-a-Changelog `CHANGELOG.md` as a second output format.
- Publishing, tagging policy beyond the existing `vX.Y.Z` tag, and release automation.
- Lockstep versions across a monorepo — parts stay independent by design.
