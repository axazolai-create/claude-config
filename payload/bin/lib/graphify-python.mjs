// Locate the interpreter that has graphify. GRAPHIFY_PYTHON wins, then a uv/pipx tool venv,
// then a PATH python that can `import graphify`. null = none found. Never throws; `run`/`env`
// are injectable for tests.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

const venvPython = (base) =>
  platform() === "win32"
    ? join(base, "graphifyy", "Scripts", "python.exe")
    : join(base, "graphifyy", "bin", "python");

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
