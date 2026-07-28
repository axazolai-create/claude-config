# Plan: graphify → Neo4j setup — test-before-save + driver-with-graphify

Date: 2026-07-24
Status: Proposed
Scope: claude-config bootstrap (`setup.mjs`, `graphify-setup.mjs`, `neo4j-config.mjs`)
Supersedes: C4 of `2026-07-21-graphify-neo4j-design.md` (write-then-hope → test-then-save)

## Why

Provisioning the global graph → Neo4j on a *second* PC failed in two ways (diagnosed
2026-07-24 against the real NAS):

1. `graphify-setup.mjs` installs extras `pdf,office,sql,mcp` — **no `neo4j`** → the python
   driver is absent, so `graphify export neo4j --push` (and any auth test) cannot run.
2. `setup.mjs` C4 defaults the URI to `bolt://localhost:7687` and **writes `neo4j.env`
   without testing** → a wrong host / wrong password is saved silently and the push fails
   later, far from the prompt.

Confirmed facts (this session):
- NAS Neo4j **5.26.28 community** is up at `bolt://192.168.8.4:7687`; global graph already
  loaded there (269 nodes, labels `Code`/`Concept`); read path works (`RETURN 1 = 1`).
- This PC is correctly configured (driver `neo4j 6.2.0` in the uv graphify venv). Only the
  *other* PC is broken → the fix belongs in provisioning, not on one machine.
- **Bug:** `setup.mjs:210 ask()` lowercases its answer and is used for the password
  (`setup.mjs:926`) → any password with uppercase is corrupted on write. Must use `askRaw`.

## User directive (this session, overrides C4)

> No env-vars / no flag-defaults. When configuring Neo4j: **ask** address, **clarify** port,
> **request** password. **Test** the answer; **save to user scope only if it works.**

## Stages

### Stage 1 — driver installs with the Neo4j flow, not as a blanket extra (`ensureNeo4jDriver`)
- **Decided (see Stage 5): the driver is NOT added to `graphify-setup.mjs` extras.** A blanket
  extra would pull the driver into lite too, where the whole Neo4j feature is opt-in. Instead the
  driver is installed inside the C4 connection flow via `ensureNeo4jDriver` (uv `--with neo4j` →
  pipx inject → pip), which runs exactly when the user configures Neo4j — full always, lite only
  when the ecosystem is opted in. `graphifyy[neo4j]` is confirmed a valid extra (used by
  `ensureNeo4jDriver`'s uv path).
- Rationale: ties driver presence to the user's Neo4j choice, so lite stays clean by default.

### Stage 2 — reusable connection test (`payload/bin/lib/neo4j-config.mjs`)
New `testNeo4jConnection({ uri, user, password, python })` → `{ ok, nodeCount?, error? }`:
1. `parseBoltHostPort` + `probeReachable` (already here) — fast TCP gate.
2. Real auth+read: spawn `<graphify-python> -c "<RETURN 1 + count>"`, creds via **env** (never
   argv), parse `READ_OK nodes=N`. `bolt://` scheme (direct, avoids routing to advertised host).
- Unit-tested in `neo4j-config.test.mjs` (unreachable host → `ok:false`; parse of both outputs).
- Why here: `neo4j-config.mjs` already owns config + `probeReachable`; keeps `setup.mjs` lean
  and makes the test independently unit-testable (mirrors existing test file).

### Stage 3 — C4 rewrite (`setup.mjs:915-949`)
- Prompts via **`askRaw`** (case-preserving): host, port (default `7687`), user (default
  `neo4j`), password. Build `bolt://${host}:${port}`.
- Best-effort ensure driver present (locate graphify python; if `import neo4j` fails, ensure
  via Stage-1 path). **Decision point D1 below.**
- `testNeo4jConnection(...)`:
  - **pass** → write `~/.graphify/neo4j.env` (chmod 600) + `GRAPHIFY_NEO4J="1"`; print node count.
  - **fail** → do NOT write; print the error; leave `GRAPHIFY_NEO4J` unset (re-asks next run,
    matching the existing filesystem-failure idiom). Never abort the rest of setup.
- Keep the `VARIANT === "full" && INTERACTIVE` gate unchanged.

### Stage 4 — docs + risk
- Update C4 of the design spec (write-then-hope → test-then-save) and its §5 verify bullet.
- `RISK_REGISTER.md`: add RISK-NEO4J-006 (test needs driver — ordering/availability).

## How to verify quality
- `node --test` on `neo4j-config.test.mjs` (new `testNeo4jConnection` cases) — green.
- `setup-variants.e2e.test.mjs` — still green (confirm it does not assert the C4 prose
  byte-for-byte; if it does, update the fixture).
- Manual smoke on this PC: run setup interactively, enter `192.168.8.4` / `7687` / real pw →
  test prints `nodes=269`, `neo4j.env` written; enter a wrong pw → not saved, clear error.
- `git grep -i neo4j_password` → nothing (secret stays in `~/.graphify/neo4j.env`).

### Stage 5 — optional Neo4j ecosystem in the lite variant (opt-in at install)

Lite excludes the whole Neo4j feature by default. Per user directive it becomes an install-time
opt-in — "confirm → the full graphify Neo4j ecosystem (driver + cypher + read/write) is included;
decline → previously-installed components are pruned."

- `variants.json` (lite): new `optional.neo4j` group listing the ecosystem globs
  (`bin/lib/neo4j-config*`, `bin/graphify-neo4j-*`, `graphify-neo4j.cypher`, `commands/init-mcp.md`).
  Scope = **read + write** (init-mcp.md brings the Cypher read MCP). The globs stay in `exclude`
  too, so the default (group inactive) is unchanged.
- `variants.mjs` `resolveVariant({..., activeOptional})`: an active group's globs win over
  `exclude` (installed this run). Unknown group name = no-op (never throws). Full = identity, so
  optional groups are a no-op there.
- `setup.mjs`: BEFORE `resolveVariant`, in lite + interactive, ask "include the graphify Neo4j
  ecosystem?"; default = current filesystem state (`bin/lib/neo4j-config.mjs` present) so re-runs
  are idempotent; non-TTY keeps the installed state. Sets `NEO4J_ECOSYSTEM` (full ⇒ always true)
  and `activeOptional`. The C4 connection prompt is gated on `NEO4J_ECOSYSTEM` (full || lite-opted-in).
- **Opt-out = files only** (user decision): the ecosystem stays excluded → the existing
  `pruneStale` removes the previously-installed files (they are in the old manifest, excluded now,
  unchanged → deleted). The Python driver, `~/.graphify/neo4j.env`, and any MCP registration are
  left untouched (user data / shared toolchain; uninstalling packages/creds is too invasive).

## Resolved decisions
- **D1 — test needs the driver → (a) auto-ensure then test.** `ensureNeo4jDriver` installs it in
  the C4 flow; fallback to (c) require-driver messaging only if graphify itself is absent.
- **D2 — password echo → accept echo.** `askRaw` is case-preserving (the load-bearing fix); no
  muted reader (local terminal, LAN Neo4j password).
- **Lite scope → read + write** (includes `commands/init-mcp.md`).
- **Lite opt-out → files only** (no driver/creds/MCP removal).
