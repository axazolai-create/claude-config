// Renders the ultrapowers work segment. Three modes, switched wholesale: in two of them the
// leading token is one phase's id, in the third it is a tally across all phases, and those are
// different kinds of thing in the same position.
const C = { green: "32", cyan: "36", yellow: "33", red: "31" };
const paint = (s, colour) => `\x1b[${colour}m${s}\x1b[0m`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function renderPhaseSegment(state) {
  const s = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  if (s.mode === "tally") {
    if (!s.name || !Number.isFinite(Number(s.phasesTotal))) return "";
    return `${paint(num(s.phasesDone), C.green)}/${num(s.phasesTotal)} ${s.name}`;
  }
  if (!s.id || !s.name) return "";
  const c = s.counts;
  const queued = c ? num(c.queued) : -1;
  // A negative queue means the fields contradict each other. Printing arithmetic that is
  // provably wrong is worse than printing none, so it degrades to the action mode.
  if (s.mode === "executing" && c && queued >= 0) {
    const fixing = num(c.fixing);
    const inWork = num(c.active) + fixing;
    const blocked = num(c.blocked);
    const cells = [
      paint(num(c.done), C.green),
      paint(inWork, fixing > 0 ? C.yellow : C.cyan),
      String(queued),
    ];
    if (blocked > 0) cells.push(paint(blocked, C.red));
    return `${s.id} ${cells.join("/")} — ${s.name}`;
  }
  if (!s.action) return `${s.id} ${s.name}`;
  return `${s.id} (${paint(s.action, s.status === "blocked" ? C.red : C.cyan)}) ${s.name}`;
}
