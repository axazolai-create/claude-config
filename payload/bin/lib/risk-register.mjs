export const SECTIONS = ["Active", "Deferred", "Mitigated", "Closed"];

const HEADING = /^(##|###)\s+(RISK-([A-Z0-9]+)-(\d+))\s+—\s+(.+?)\s*$/;
const SECTION = /^##\s+(Active|Deferred|Mitigated|Closed)\s*$/;
const STATUS = /^-\s+\*\*Status:\*\*\s*(.+?)\s*$/;

const VALID_STATUS = [
  /^Active$/,
  /^Deferred \(.+\)$/,
  /^Mitigated$/,
  /^Closed \(\d{4}-\d{2}-\d{2}\) — .+$/,
];

export function parseRegister(text) {
  const lines = String(text ?? "").split("\n");
  const entries = [];
  const preamble = [];
  let section = null;
  let current = null;
  for (const line of lines) {
    const sec = SECTION.exec(line);
    if (sec && !HEADING.test(line)) { section = sec[1]; current = null; continue; }
    const head = HEADING.exec(line);
    if (head) {
      current = { id: head[2], prefix: head[3], num: Number(head[4]), title: head[5], status: null, lines: [], section };
      entries.push(current);
      continue;
    }
    if (!current) { preamble.push(line); continue; }
    const st = STATUS.exec(line);
    if (st && current.status === null) current.status = st[1];
    current.lines.push(line);
  }
  return { preamble, entries };
}

export function sectionFor(status) {
  if (/^Closed/.test(status ?? "")) return "Closed";
  if (/^Deferred/.test(status ?? "")) return "Deferred";
  if (/^Mitigated$/.test(status ?? "")) return "Mitigated";
  return "Active";
}

export function lintRegister({ entries }, { knownAdrIds = [] } = {}) {
  const problems = [];
  const seen = new Set();
  const known = new Set(knownAdrIds);
  for (const e of entries) {
    if (seen.has(e.id)) problems.push({ id: e.id, problem: `duplicate id — ${e.id} appears more than once` });
    seen.add(e.id);
    if (!e.status) problems.push({ id: e.id, problem: "no Status field" });
    else if (!VALID_STATUS.some((re) => re.test(e.status)))
      problems.push({ id: e.id, problem: `status "${e.status}" is outside the vocabulary (Active, Deferred (…), Mitigated, Closed (date) — why)` });
    if (e.section && e.status && sectionFor(e.status) !== e.section)
      problems.push({ id: e.id, problem: `wrong section — status maps to ${sectionFor(e.status)}, entry sits under ${e.section}` });
    for (const m of e.lines.join("\n").matchAll(/\bADR-(\d{4})\b/g))
      if (!known.has(`ADR-${m[1]}`)) problems.push({ id: e.id, problem: `dangling reference to ADR-${m[1]}` });
  }
  return problems;
}

export function nextId({ entries }, prefix) {
  const used = entries.filter((e) => e.prefix === prefix).map((e) => e.num);
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `RISK-${prefix}-${String(next).padStart(3, "0")}`;
}
