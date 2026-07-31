---
status: accepted
date: 2026-07-31
---

# ADR-0002 setup.mjs prints plugin install commands instead of running them

## Context

The installer could run `claude plugin install` itself and report the plugin set as configured.
It knows which plugins a profile wants, and the commands are not hard to spawn.

## Decision

It prints them instead, and the user runs them. The installer edits `enabledPlugins` — a local,
reversible change to a JSON file — but never installs, uninstalls or registers a marketplace on
its own. Under a bulk flag it does not even do that: only the interactive path, where a human
answers, executes anything.

## Consequences

`enabledPlugins` resolves at startup and does not hot-reload, so an installer claiming to have
"enabled" a plugin mid-session would be stating something untrue about the running session. The
printed commands plus a restart are the only sequence that is actually true, and the output says
so. Registering a marketplace fetches and trusts remote code, so it gets the same gate as
installing rather than a weaker one for being a prerequisite. The cost is a second step the user
must take, which is preferred to a first step that lies.
