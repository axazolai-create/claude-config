# Probe D — which hook events fire around a plugin change

**Date:** 2026-07-27
**Machine:** Windows 11, Claude Code, `superpowers@claude-plugins-official` 6.2.0
**Question:** the documented hook-event list contains no plugin-lifecycle event, and `/reload-plugins`
emits nothing of its own. Do `ConfigChange`, `UserPromptSubmit`, or `FileChanged` reach us anyway?
**Method:** a logging hook (`probe-d-event-log.mjs`) registered on all three, session restarted,
then two triggers — a file edit inside the plugin cache followed by `/reload-plugins`, and a
separate edit to `~/.claude/settings.json`.

## Result

| Event | Registered | Fired on a plugin-cache file edit | Fired on `/reload-plugins` | Fired on a `settings.json` edit |
|---|---|---|---|---|
| `UserPromptSubmit` | yes (new) | n/a | **no** | n/a |
| `ConfigChange` | yes (new) | **no** | no | **yes** |
| `FileChanged` | yes (added a matcher-less entry beside the pre-existing `config.json` one) | **no** | no | no |

`UserPromptSubmit` did fire — twice — but only on genuine user messages. It never saw
`/reload-plugins`.

## What this settles

**1. There is no instant trigger for a plugin change.** Neither the plugin-cache edit nor the
reload produced any event. `SessionStart` plus a manual `/up-doctor` is not a fallback — it is the
only available path. The layer 0 plan already treats it as load-bearing; nothing there changes.

**2. Built-in slash commands do not reach `UserPromptSubmit`.** This kills the idea of hooking
`/reload-plugins` by matching prompt text. The hook is real and useful, but it is fed only genuine
user input:

```json
{
  "session_id": "...", "transcript_path": "...", "cwd": "...",
  "prompt_id": "...", "hook_event_name": "UserPromptSubmit",
  "prompt": "..."
}
```

Whether *custom* slash commands (`.claude/commands/*.md`) reach it was not tested — only built-ins
were. Worth knowing before designing anything that depends on intercepting a command.

**3. `ConfigChange` is real, and narrower than hoped.** It fires on config files, not on plugin
content. A skill file edited inside the plugin cache produced nothing; `~/.claude/settings.json`
produced this:

```json
{
  "session_id": "...", "transcript_path": "...", "cwd": "...",
  "prompt_id": "...", "hook_event_name": "ConfigChange",
  "source": "user_settings",
  "file_path": "C:\\Users\\Axa\\.claude\\settings.json"
}
```

The field is `source`, not `config_source` as the documentation summary suggested. Observed value:
`user_settings`.

**4. `FileChanged` does not watch the plugin cache.** It is a real event — this machine already had
one registered under matcher `config.json` before the probe — but the watched set does not extend to
`~/.claude/plugins/cache/`.

## Unplanned finding: config events broadcast across sessions

The single `settings.json` edit fired `ConfigChange` **twice, in two different sessions**, 20 ms
apart:

```
session 6ee1e3a6…  cwd D:\6__Work\SMB-Sync
session 1b5ea289…  cwd D:\6__Work\claude-config
```

A user-scope config change reaches every live session on the machine, each with its own `cwd`. This
is the same hazard приложение С of the source analysis documents for parallel projects — a hook
guarding another project's state. Any future `ConfigChange` handler must key on its own `cwd` and
must be idempotent under concurrent invocation, or two sessions will race on the same file.

## Effect on the layer 0 plan

- Task 8, Step 5 is answered: **no instant drift trigger exists.** Record the negative result and
  do not open a follow-up. The question is closed, not deferred.
- `ConfigChange` remains interesting for a different purpose — detecting that `/init-stack` has
  rewritten `settings.json` — but that is not layer 0's problem.
- No change to any other task.

## Cleanup performed

Plugin file restored from backup (marker gone, verified), `settings.json` restored from backup
(probe hooks and the probe env var gone, verified structurally), `~/.claude/probe-d.jsonl` deleted.
`probe-d-event-log.mjs` is kept in the repository as the artifact that produced this result.
