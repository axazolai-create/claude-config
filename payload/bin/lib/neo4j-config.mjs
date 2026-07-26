import { readFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";

export const NEO4J_ENV_PATH = join(homedir(), ".graphify", "neo4j.env");
export const GLOBAL_GRAPH_PATH = join(homedir(), ".graphify", "global-graph.json");

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadNeo4jConfig(path = NEO4J_ENV_PATH) {
  if (!existsSync(path)) return { ok: false, error: `config not found: ${path}` };
  const env = parseEnvFile(readFileSync(path, "utf8"));
  const uri = env.NEO4J_URI;
  const user = env.NEO4J_USER || "neo4j";
  const password = env.NEO4J_PASSWORD;
  const missing = [];
  if (!uri) missing.push("NEO4J_URI");
  if (!password) missing.push("NEO4J_PASSWORD");
  if (missing.length) return { ok: false, error: `missing ${missing.join(", ")} in ${path}` };
  return { ok: true, config: { uri, user, password } };
}

export function parseBoltHostPort(uri) {
  if (!uri) return null;
  const m = String(uri).match(/^(?:bolt|neo4j)(?:\+s|\+ssc)?:\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 7687 };
}

export function repoTagsFromGlobalGraph(graphJsonText) {
  const data = JSON.parse(graphJsonText);
  const tags = new Set();
  for (const n of data.nodes || []) if (n && n.repo) tags.add(n.repo);
  return [...tags];
}

export function probeReachable(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

// --- setup.mjs C4 support: locate graphify's interpreter, ensure the driver, test the link ---

// The python one-liner that proves the FULL read path (connect + auth + a real Cypher read),
// not just an open port. Creds arrive via env (_U/_N/_P) so they never touch argv/shell history.
// bolt:// is used by the caller (direct connection) to avoid neo4j:// routing to an advertised host.
const READ_TEST_PY = [
  "import os,sys",
  "from neo4j import GraphDatabase",
  "d=GraphDatabase.driver(os.environ['_U'],auth=(os.environ['_N'],os.environ['_P']))",
  "d.verify_connectivity()",
  "s=d.session()",
  "n=s.run('MATCH (x) RETURN count(x) AS c').single()['c']",
  "s.close();d.close()",
  "sys.stdout.write('READ_OK nodes=%d' % n)",
].join("\n");

const venvPython = (base) =>
  platform() === "win32"
    ? join(base, "graphifyy", "Scripts", "python.exe")
    : join(base, "graphifyy", "bin", "python");

// Best-effort: the interpreter that has graphify (+ its neo4j driver). GRAPHIFY_PYTHON wins,
// then a uv/pipx tool venv, then a PATH python that can `import graphify`. null = none found.
export function findGraphifyPython({ run = spawnSync, env = process.env } = {}) {
  if (env.GRAPHIFY_PYTHON && existsSync(env.GRAPHIFY_PYTHON)) return env.GRAPHIFY_PYTHON;
  const uv = run("uv", ["tool", "dir"], { encoding: "utf8" });
  if (uv && !uv.error && uv.status === 0) {
    const p = venvPython(String(uv.stdout || "").trim());
    if (p && existsSync(p)) return p;
  }
  const px = run("pipx", ["environment", "--value", "PIPX_LOCAL_VENVS"], { encoding: "utf8" });
  if (px && !px.error && px.status === 0) {
    const p = venvPython(String(px.stdout || "").trim());
    if (p && existsSync(p)) return p;
  }
  for (const py of ["python3", "python"]) {
    const r = run(py, ["-c", "import graphify"], { encoding: "utf8" });
    if (r && !r.error && r.status === 0) return py;
  }
  return null;
}

export function driverInstalled(python, { run = spawnSync } = {}) {
  if (!python) return false;
  const r = run(python, ["-c", "import neo4j"], { encoding: "utf8" });
  return !!r && !r.error && r.status === 0;
}

// D1 (auto-install then test): make the neo4j driver importable in graphify's env. uv -> pipx -> pip.
// Idempotent: a present driver short-circuits. Returns { ok, method?, already?, error? }.
export function ensureNeo4jDriver(python, { run = spawnSync } = {}) {
  if (driverInstalled(python, { run })) return { ok: true, already: true };
  const opts = { stdio: "inherit" };
  const uv = run("uv", ["--version"], { encoding: "utf8" });
  if (uv && !uv.error && uv.status === 0) {
    run("uv", ["tool", "install", "graphifyy", "--with", "neo4j"], opts);
    if (driverInstalled(python, { run })) return { ok: true, method: "uv" };
  }
  const px = run("pipx", ["--version"], { encoding: "utf8" });
  if (px && !px.error && px.status === 0) {
    run("pipx", ["inject", "graphifyy", "neo4j"], opts);
    if (driverInstalled(python, { run })) return { ok: true, method: "pipx" };
  }
  if (python) {
    run(python, ["-m", "pip", "install", "neo4j"], opts);
    if (driverInstalled(python, { run })) return { ok: true, method: "pip" };
  }
  return { ok: false, error: "could not install the neo4j driver (tried uv/pipx/pip)" };
}

export function parseReadResult(stdout) {
  const m = String(stdout).match(/READ_OK nodes=(\d+)/);
  return m ? { ok: true, nodeCount: Number(m[1]) } : { ok: false };
}

// Test a candidate Neo4j connection end-to-end BEFORE anything is persisted:
// parse URI -> TCP reachability -> real driver connect+auth+read. Returns
// { ok, nodeCount?, error? }. Never throws; `run`/`probe` are injectable for tests.
export async function testNeo4jConnection(
  { uri, user, password, python },
  { run = spawnSync, probe = probeReachable } = {},
) {
  const hp = parseBoltHostPort(uri);
  if (!hp) return { ok: false, error: `cannot parse URI '${uri}'` };
  if (!(await probe(hp.host, hp.port))) return { ok: false, error: `${hp.host}:${hp.port} unreachable` };
  if (!python) return { ok: false, error: "no graphify python found (neo4j driver unavailable to test)" };
  const env = { ...process.env, _U: uri, _N: user, _P: password };
  const r = run(python, ["-c", READ_TEST_PY], { env, encoding: "utf8" });
  if (!r || r.error) return { ok: false, error: `driver run failed: ${r && r.error ? r.error.message : "unknown"}` };
  const parsed = parseReadResult(r.stdout || "");
  if (parsed.ok) return { ok: true, nodeCount: parsed.nodeCount };
  const detail = (String(r.stderr || "") + String(r.stdout || "")).replace(/\s+/g, " ").trim();
  return { ok: false, error: detail ? detail.slice(0, 300) : `driver exited ${r.status}` };
}
