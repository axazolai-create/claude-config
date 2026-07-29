#!/usr/bin/env node
// task-lifecycle-probe.mjs
//
// Разведочный хук: ничего не решает, только записывает, что ему прислали.
// Нужен, чтобы узнать реальные схемы событий Claude Code вместо догадок —
// какие поля приходят в TaskCreated, TaskCompleted, SubagentStop, PostCompact.
//
// Вешается на любое событие. Пишет по строке JSON на вызов в
//   %TEMP%\claude-hooks\lifecycle-probe.jsonl
// (переопределяется PROBE_LOG). Ничего не блокирует: всегда exit 0.
//
// Регистрация — пример для нескольких событий сразу:
//   "TaskCreated":   [ { "hooks": [ { "type": "command", "command": "node",
//                        "args": ["C:/Users/Axa/.claude/hooks/task-lifecycle-probe.mjs"] } ] } ],
//   "TaskCompleted": [ { "hooks": [ ... то же ... ] } ],
//   "SubagentStop":  [ { "hooks": [ ... то же ... ] } ],
//   "PostCompact":   [ { "hooks": [ ... то же ... ] } ]
//
// Снять после разведки: удалить записи из settings.json.
//
// Разбор собранного:
//   Get-Content "$env:TEMP\claude-hooks\lifecycle-probe.jsonl" | ForEach-Object {
//     ($_ | ConvertFrom-Json).payload.PSObject.Properties.Name } | Sort-Object -Unique

import { mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const LOG = process.env.PROBE_LOG || join(tmpdir(), "claude-hooks", "lifecycle-probe.jsonl");

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    parseError = String(e?.message ?? e).slice(0, 200);
  }

  const record = {
    at: new Date().toISOString(),
    // Имя события хук из stdin не всегда получает — берём и оттуда, и из окружения.
    event:
      payload?.hook_event_name ??
      payload?.hookEventName ??
      process.env.CLAUDE_HOOK_EVENT ??
      null,
    // Верхнеуровневые ключи — самое ценное: сразу видно, есть ли cwd, task, session.
    keys: payload && typeof payload === "object" ? Object.keys(payload) : null,
    payload,
    rawLength: raw.length,
    parseError,
  };

  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* разведка не должна ломать сессию */
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0)); // никогда не блокирует
