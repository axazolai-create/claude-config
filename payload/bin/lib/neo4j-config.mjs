import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import net from "node:net";

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
