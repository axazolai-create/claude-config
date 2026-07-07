---
description: Set up / switch / remove per-project MCP servers (git host, Postgres, web search) with consent, auth, and verification
argument-hint: "[github|gitlab|postgres|search|status]"
allowed-tools: Bash(claude *), Bash(git *), Bash(gh *), Bash(glab *), Bash(npx *), Bash(uvx *), Bash(docker *), WebSearch, Read
---

Set up MCP servers for THIS project. This is the MCP counterpart to `/init-stack` (which does
marketplace plugins). It is **re-entrant and reconfigurable**: on every run, read the current
state first and let me CHANGE a previous choice (e.g. switch the git host from GitHub to GitLab)
or remove a server. Never install a tool, add a marketplace, run an auth/OAuth flow, or write MCP
config without my explicit OK. My on-screen confirmation of a specific action IS that OK.

Most of these servers talk to a network API or a service I run; only Postgres and SearXNG are
fully local. Flag the cloud/no-cloud status when you propose each.

## 0. Read current state (always first, no writes)
- `claude mcp list` - which servers are already configured (github/gitlab/postgres/search/...).
- `git remote -v` - detect the git host of this repo (github.com / gitlab.* / bitbucket / a
  self-hosted host / none).
- Show me a short summary: "Current MCP: <list>. Git remote: <host>." Then offer the actions
  below. If I passed an argument (`github`/`gitlab`/`postgres`/`search`/`status`), jump to it;
  `status` just prints this summary and stops.

## 1. Git host (GitHub or GitLab) - single active choice, switchable
Detect from the remote, but let me override (I may want a host that differs from `origin`).

**If a git-host MCP is already configured**, show it and offer: keep / re-authenticate / **switch
provider** / remove. On switch or remove, first `claude mcp remove <name>` the old one, then run
the target provider's setup below. This is what makes the choice reversible on re-run.

### GitHub (remote MCP, OAuth - no `gh` CLI needed)
- Confirm with me, then: `claude mcp add --transport http github https://api.githubcopilot.com/mcp/`
- First use triggers a browser OAuth device flow - tell me to complete it. For a host without
  OAuth, offer the PAT form instead: same command + `--header "Authorization: Bearer <PAT>"`.
- `gh` CLI is OPTIONAL (only for git ops via Bash, not for this MCP). If I want it and it's
  missing, offer to install it (consent; `winget/scoop/choco` on Windows, `brew`/pkg mgr on
  macOS/Linux) then `gh auth login`, and after install VERIFY: `gh auth status`.
- Verify the MCP: `claude mcp list` shows `github` connected; then have it list a repo/issue.

### GitLab (MCP via `claude mcp add`; works with self-hosted)
- No official plugin exists - use the `@zereight/mcp-gitlab` server. Confirm, then (PAT form):
  `claude mcp add gitlab -e GITLAB_PERSONAL_ACCESS_TOKEN=<tok> -e GITLAB_API_URL="https://gitlab.com/api/v4" -e GITLAB_PERMISSION_MODE=readonly -- npx -y @zereight/mcp-gitlab`
- Self-hosted: set `GITLAB_API_URL="https://gitlab.example.com/api/v4"`. Permission modes:
  `readonly | modify | full` (default full - prefer `readonly` unless I ask for writes).
- Ask me for the token (or point me to create one: GitLab -> Settings -> Access Tokens, `api`
  scope). Never echo the token back.
- Optional `glab` CLI (GitLab's `gh` equivalent): if wanted and missing, offer to install
  (`winget install glab.glab` / `brew install glab` / pkg mgr), then `glab auth login`, and
  VERIFY: `glab auth status`.
- Verify the MCP via `claude mcp list`.

### Other host / host-agnostic
- If `origin` is Bitbucket or something else, say there's no first-class MCP set up here; offer:
  reconfigure to GitHub/GitLab above, or a host-agnostic LOCAL git MCP for log/diff/blame only
  (`claude mcp add git -- uvx mcp-server-git`) which works with any host but has no PR/issue tools.

## 2. Postgres (opt-in, fully local, no cloud)
- Only if I ask. Confirm, then: `claude mcp add postgres -e DATABASE_URI="postgresql://user:pass@host:port/db" -- uvx postgres-mcp --access-mode=restricted`
- `--access-mode=restricted` = read-only-ish (safe default); mention `unrestricted` exists but
  don't use it unless I explicitly ask. This mirrors the repo's db-live-access-gate posture.
- Needs `uv`/`uvx` present (see `graphify-setup.mjs --bootstrap-uv` if missing - with consent).
- Verify: `claude mcp list` shows `postgres`; then have it read the schema.

## 3. Web search (opt-in). Default: the built-in WebSearch tool - add nothing.
- Only if I want an independent/self-hosted search. Recommend **SearXNG self-hosted** (fully
  local, no key): I run SearXNG in Docker, then add a SearXNG MCP pointed at it.
- The exact SearXNG MCP package changes over time - **verify the current one via WebSearch before
  adding** rather than assuming a name; then `claude mcp add search -e SEARXNG_URL="http://localhost:8080" -- npx -y <verified-searxng-mcp-package>`.
- Do NOT propose Brave: as of 2026 its free tier is gone (metered billing, card required) - not
  free, not no-cloud. Only mention it if I explicitly ask.
- Verify via `claude mcp list`.

## 4. Finish
- Summarize what was added / switched / removed.
- MCP servers added at project scope live in `./.claude/settings.json` (or `.mcp.json`); user
  scope via `--scope user`. Remind me a NEW session picks them up; some clients need a restart.
- Re-running `/init-mcp` shows this state again and lets me change any of it.
