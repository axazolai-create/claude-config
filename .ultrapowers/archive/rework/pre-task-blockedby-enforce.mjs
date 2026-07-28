#!/usr/bin/env node
// pre-task-blockedby-enforce.mjs
//
// PreToolUse хук на TaskUpdate: запрещает перевод задачи в in_progress,
// пока её blockedBy указывает на незакрытые задачи.
//
// Платформа сама этого не делает — проба 27.07.2026 показала, что blockedBy
// является советующим маркером: перевод заблокированной задачи в работу
// проходит молча, без ошибки и предупреждения.
//
// ОТЛИЧИЕ ОТ ОРИГИНАЛА pcvelz/superpowers:
// оригинал реконструирует состояние задач, проигрывая транскрипт заново.
// Это даёт три тихих отказа:
//   1. идентификаторы угадываются счётчиком с единицы — ломается в любой
//      возобновлённой сессии, где платформа продолжает нумерацию;
//   2. компактификация обрезает транскрипт — созданное до /compact исчезает
//      из реконструкции вместе с blockedBy;
//   3. зависимости, проставленные в прошлой сессии, невидимы.
// Здесь состояние берётся из ~/.claude/tasks/<list>/<id>.json — источник
// authoritative, и все три отказа исчезают.
//
// Формат записи задачи (подтверждён на диске):
//   { "id": "1", "subject": "...", "description": "...", "activeForm": "...",
//     "status": "pending", "blocks": [], "blockedBy": [] }
//
// Язык: Node, а не bash — в окружении Windows bash-хуки тянут Git Bash,
// а он под MinTTY даёт isTTY=false и гасит сами Task-инструменты.
//
// Аварийный выключатель: BLOCKEDBY_GUARD=0
// Трасса решений:        %TEMP%\claude-hooks\gate-trace.log
//                        (переопределяется GATE_TRACE_LOG)

import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ALLOW = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
});

const TRACE_LOG = process.env.GATE_TRACE_LOG || join(tmpdir(), "claude-hooks", "gate-trace.log");

let TRACE_LIST = "-"; // проставляется, как только известен список

function trace(taskId, event, reason) {
  try {
    mkdirSync(join(TRACE_LOG, ".."), { recursive: true });
    const line = `${new Date().toISOString()} | pre-blockedby | list=${TRACE_LIST} | task=${taskId ?? "?"} | ${event}${reason ? ` | ${reason}` : ""}\n`;
    appendFileSync(TRACE_LOG, line, "utf8");
  } catch {
    /* трасса никогда не роняет хук */
  }
}

function allow(taskId, event, reason) {
  trace(taskId, event, reason);
  process.stdout.write(ALLOW);
  process.exit(0);
}

function block(taskId, message) {
  trace(taskId, "block", "blockers-open");
  process.stderr.write(message);
  process.exit(2); // exit=2 + stderr = отказ, текст уходит модели
}

// ── Каталог списка задач ──────────────────────────────────────────────────
// ВАЖНО: ~/.claude/tasks/ общий на всю машину. Если на этом ПК параллельно
// работает другой проект, «самый свежий по времени каталог» может оказаться
// его — и хук начнёт стеречь порядок чужих задач. Поэтому угадывания по mtime
// здесь нет: список определяется явно, иначе хук честно пропускает вызов.
//
// Порядок разрешения:
//   1. CLAUDE_CODE_TASK_LIST_ID из окружения;
//   2. файл <cwd>/.claude/task-list-id (одна строка) — если переменную
//      неудобно держать в окружении каждой оболочки;
//   3. отказ от работы: fail-open с причиной no-list-id в трассе.
// Возвращает { dir, listId } либо { reason } — причина попадает в трассу,
// чтобы не гадать, чего именно не хватило: cwd, файла-маркера или каталога.
function resolveTaskList(cwd) {
  const base = join(homedir(), ".claude", "tasks");
  if (!existsSync(base)) return { reason: "no-tasks-root" };

  let listId = (process.env.CLAUDE_CODE_TASK_LIST_ID || "").trim();
  let source = listId ? "env" : "";

  if (!listId) {
    if (!cwd) return { reason: "no-cwd-no-env" };
    const marker = join(cwd, ".claude", "task-list-id");
    if (!existsSync(marker)) return { reason: "no-marker-no-env" };
    try {
      listId = readFileSync(marker, "utf8").trim().split(/\r?\n/)[0] || "";
    } catch {
      return { reason: "marker-unreadable" };
    }
    if (!listId) return { reason: "marker-empty" };
    source = "marker";
  }

  // Защита от подстановки пути через значение переменной.
  if (/[\\/:*?"<>|]/.test(listId)) return { reason: "list-id-rejected" };

  const dir = join(base, listId);
  if (!existsSync(dir)) return { reason: `list-dir-missing:${listId}` };

  return { dir, listId, source };
}

// Чтение задачи. .lock в каталоге говорит, что запись конкурентна —
// лок не берём, но один повтор при рваном чтении делаем.
function readTask(dir, id) {
  const p = join(dir, `${id}.json`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

// ── Основной путь ─────────────────────────────────────────────────────────
async function main() {
  if (process.env.BLOCKEDBY_GUARD === "0") allow(null, "skip", "guard=0");

  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  // Разовый дамп сырого payload: GATE_DEBUG_PAYLOAD=1 -> файл рядом с трассой.
  // Нужен, чтобы за 30 секунд увидеть, какие поля Claude Code реально присылает
  // (в частности, есть ли cwd — от него зависит поиск .claude/task-list-id).
  if (process.env.GATE_DEBUG_PAYLOAD === "1") {
    try {
      mkdirSync(join(TRACE_LOG, ".."), { recursive: true });
      appendFileSync(join(TRACE_LOG, "..", "payload-sample.json"), input + "\n", "utf8");
    } catch {
      /* дамп не должен ломать хук */
    }
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    allow(null, "skip", "bad-stdin");
  }

  if (payload.tool_name !== "TaskUpdate") allow(null, "skip", `tool=${payload.tool_name}`);

  const status = payload.tool_input?.status;
  if (status !== "in_progress") allow(null, "skip", `status=${status}`);

  const taskId = String(payload.tool_input?.taskId ?? "");
  if (!taskId) allow(null, "skip", "no-task-id");

  trace(taskId, "enter", "status=in_progress");

  const resolved = resolveTaskList(payload.cwd);
  if (resolved.reason) allow(taskId, "skip", resolved.reason);
  const { dir } = resolved;
  TRACE_LIST = `${resolved.listId}(${resolved.source})`;

  const task = readTask(dir, taskId);
  if (!task) allow(taskId, "skip", "task-file-unreadable");

  // Учитываем и то, что добавляется этим же вызовом.
  const declared = new Set((task.blockedBy ?? []).map(String));
  for (const b of payload.tool_input?.addBlockedBy ?? []) declared.add(String(b));

  if (declared.size === 0) allow(taskId, "pass", "no-blockers");

  const open = [];
  for (const id of [...declared].sort((a, b) => Number(a) - Number(b))) {
    const blocker = readTask(dir, id);
    const st = blocker?.status ?? "unknown";
    // completed закрывает; cancelled и deleted означают осознанный отказ
    if (!["completed", "cancelled", "deleted"].includes(st)) {
      open.push({ id, subject: blocker?.subject ?? "?", status: st });
    }
  }

  if (open.length === 0) allow(taskId, "pass", "blockers-closed");

  const lines = open.map((b) => `  #${b.id} [${b.status}] ${b.subject}`).join("\n");
  block(
    taskId,
    `Задача #${taskId} заблокирована незакрытыми зависимостями:\n${lines}\n\n` +
      `Что делать:\n` +
      `  1. Закрыть блокеры (это и есть смысл объявленного порядка);\n` +
      `  2. Если блокер потерял актуальность — закрыть его как cancelled или deleted,\n` +
      `     а не completed: завершать невыполненную работу нельзя;\n` +
      `  3. Если порядок в плане неверен — вынести это пользователю, а не обходить.\n\n` +
      `Разовое отключение: BLOCKEDBY_GUARD=0\n`
  );
}

// Fail-open: любая необработанная ошибка пропускает вызов, а не роняет сессию.
main().catch((e) => {
  trace(null, "error", String(e?.message ?? e).slice(0, 120));
  process.stdout.write(ALLOW);
  process.exit(0);
});
