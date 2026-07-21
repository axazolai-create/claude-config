// payload/bin/lib/supervise-lib.mjs
// Pure decision logic for the background-job supervisor. No I/O, no timers — the CLI wraps
// these with a child process and a monitor loop. A "hang" is turned into a process EXIT so
// the harness's run_in_background re-invocation fires (a hang otherwise produces no event).

export const DEFAULT_TIMEOUT_S = 1800; // 30 min hard wall-clock cap
export const DEFAULT_STALE_S = 300;    // 5 min with no output => presumed stuck

// Split `--timeout N --stale N --label X -- cmd args...` into options + command argv.
// The `--` separator is optional; the first unrecognized token also starts the command.
export function parseSuperviseArgs(argv) {
  const out = { timeout: DEFAULT_TIMEOUT_S, stale: DEFAULT_STALE_S, label: "", cmd: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { i++; break; }
    else if (a === "--timeout") out.timeout = Number(argv[++i]);
    else if (a === "--stale") out.stale = Number(argv[++i]);
    else if (a === "--label") out.label = argv[++i];
    else break; // start of the wrapped command
  }
  out.cmd = argv.slice(i);
  return out;
}

// Given the current clock and the job's timestamps (ms), decide whether it looks hung.
// Wall-clock timeout takes precedence over output-staleness. A 0/negative bound disables
// that check. Returns null when healthy.
export function hangCheck({ now, startTs, lastOutputTs, timeoutMs, staleMs }) {
  const wall = now - startTs;
  if (timeoutMs > 0 && wall >= timeoutMs) return { type: "timeout", elapsedS: Math.round(wall / 1000) };
  const idle = now - lastOutputTs;
  if (staleMs > 0 && idle >= staleMs) return { type: "stale", elapsedS: Math.round(idle / 1000) };
  return null;
}

export function formatHang(label, hang) {
  const tag = label ? `supervise:${label}` : "supervise";
  const why = hang.type === "timeout"
    ? `wall-clock timeout after ${hang.elapsedS}s`
    : `no output for ${hang.elapsedS}s (presumed stuck)`;
  return `[${tag}] HANG — ${why} — killing job`;
}

export function formatExit(label, code, elapsedS) {
  const tag = label ? `supervise:${label}` : "supervise";
  return `[${tag}] job exited code=${code} after ${elapsedS}s`;
}
