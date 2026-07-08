#!/usr/bin/env node
// PreToolUse guard (matcher: Bash|^mcp__.*). Cross-platform (Node).
// INVARIANT: connected LIVE databases are read-only by default.
//   - Any statement beyond SELECT/WITH/SHOW/DESCRIBE/EXPLAIN (or a psql read-only
//     meta-command) is denied outright. Block = exit 2 (stderr fed back to Claude).
//   - A recognized read-only statement still forces an "ask" permission prompt via
//     hookSpecificOutput, so the user must approve every single query, even in an
//     "auto"/bypass-permissions session. Hooks run regardless of permission mode.
//   - If the SQL text can't be statically determined (interactive client invocation,
//     opaque MCP payload), default to "ask" rather than silently allowing.
//   - Narrow exception: `SET @var := <literal>` session-variable assignment (see
//     SESSION_VAR_SET_RE) - lets report scripts parameterize themselves before the
//     actual SELECT runs. GLOBAL/system SET and SET @var := <subquery/function> stay denied.
// Fires on: Bash calls to known DB CLI clients, and any mcp__* tool whose name looks
// DB-related. Editing/reading .sql script files on disk is NOT affected — this only
// gates actually EXECUTING something against a connected live database.
// Any parse failure => allow (exit 0), matching house style (secrets-gate.mjs etc).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function stdin() { try { return readFileSync(0, "utf8"); } catch { return ""; } }

function askDecision(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function denyHard(msg) {
  process.stderr.write(msg + "\n");
  process.exit(2);
}

// Extend this list if other DB CLI clients are used (mongosh, redis-cli, etc).
const DB_CLI_BINARIES = ["psql", "mysql", "mariadb", "sqlplus", "sqlcmd", "osql", "isql"];
// Narrow on purpose: broad terms like "query"/"execute" would false-positive-match
// unrelated MCP tools (e.g. a generic code-execution tool).
const MCP_DB_NAME_RE = /^mcp__.*(sql|database|postgres|mysql|maria|oracle|mssql|mongo).*$/i;

const READ_ONLY_START_RE = /^(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
const PSQL_META_RE = /^\\(d|dt|dn|di|l|c|q|\?|z|du)\b/i;
// Narrow exception: a session user-variable assignment to a literal only
// (SET @y := '2026', SET @late1 := 30). No GLOBAL/system vars, no subqueries,
// no function calls - those stay denied. Exists to let report scripts like
// Отчёт_ОИТ.sql parameterize themselves before the actual SELECT runs.
const SESSION_VAR_SET_RE = /^SET\s+@[a-zA-Z_][a-zA-Z0-9_]*\s*(:=|=)\s*(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?)$/i;

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])--.*$/gm, "$1")
    .replace(/(^|\s)#.*$/gm, "$1");
}

function splitStatements(sql) {
  return stripComments(sql).split(";").map(s => s.trim()).filter(Boolean);
}

// Returns { ok: true } or { ok: false, offending: "<statement>" }.
function classifyStatements(sql) {
  const stmts = splitStatements(sql);
  if (stmts.length === 0) return { ok: true };
  for (const s of stmts) {
    if (PSQL_META_RE.test(s)) continue;
    if (SESSION_VAR_SET_RE.test(s)) continue;
    if (!READ_ONLY_START_RE.test(s)) return { ok: false, offending: s };
  }
  return { ok: true };
}

function extractSqlFromBash(cmd, cwd) {
  const flagMatch = cmd.match(/-[ce]\s+(?:"([^"]*)"|'([^']*)')/);
  if (flagMatch) return flagMatch[1] ?? flagMatch[2];

  const heredocMatch = cmd.match(/<<\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1\b/);
  if (heredocMatch) return heredocMatch[2];

  const fileMatch = cmd.match(/<\s*(?:"([^"]+\.sql)"|'([^']+\.sql)'|(\S+\.sql))/i);
  if (fileMatch) {
    const rel = fileMatch[1] || fileMatch[2] || fileMatch[3];
    try { return readFileSync(resolve(cwd, rel), "utf8"); } catch { return null; }
  }
  return null;
}

let d = {};
try { d = JSON.parse(stdin() || "{}"); } catch { process.exit(0); }

const toolName = d.tool_name || "";
const cwd = d.cwd || process.cwd();

if (toolName === "Bash") {
  const cmd = ((d.tool_input || {}).command) || "";
  const usesDbClient = DB_CLI_BINARIES.some(bin =>
    new RegExp(`(^|[;&|\\s])${bin}(\\.exe)?(\\s|$)`, "i").test(cmd)
  );
  if (!usesDbClient) process.exit(0);

  const sql = extractSqlFromBash(cmd, cwd);
  if (sql == null) {
    askDecision("Live DB client invoked without inline SQL Claude could inspect statically - approve manually before it runs.");
  }
  const verdict = classifyStatements(sql);
  if (!verdict.ok) {
    denyHard(
      "Denied: only read-only SQL (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN) is allowed against a connected live database.\n" +
      "Offending statement: " + verdict.offending + "\n" +
      "If a write/DDL is genuinely needed, ask the user directly for explicit approval - this gate does not grant exceptions."
    );
  }
  askDecision("Read-only SQL against a connected live database - confirm the why/what was stated before approving.");
}

if (MCP_DB_NAME_RE.test(toolName)) {
  const input = d.tool_input || {};
  const candidateFields = ["query", "sql", "statement", "command", "script"];
  let sql = null;
  for (const f of candidateFields) {
    if (typeof input[f] === "string" && input[f].trim()) { sql = input[f]; break; }
  }
  if (sql == null) {
    const strings = Object.values(input).filter(v => typeof v === "string" && v.trim());
    sql = strings.find(s => /\b(select|with|show|describe|desc|explain|insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|exec)\b/i.test(s)) || null;
  }
  if (sql == null) {
    askDecision(`DB-related MCP tool '${toolName}' called with no statically-recognizable SQL - approve manually before it runs.`);
  }
  const verdict = classifyStatements(sql);
  if (!verdict.ok) {
    denyHard(
      `Denied: only read-only SQL is allowed against a connected live database via MCP tool '${toolName}'.\n` +
      "Offending statement: " + verdict.offending
    );
  }
  askDecision(`Read-only SQL via MCP tool '${toolName}' against a connected live database - confirm the why/what was stated before approving.`);
}

process.exit(0);
