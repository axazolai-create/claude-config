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

const DEFERRED_HINT = /\b(until|pending|awaiting|blocked on)\b/i;

export function migrateStatus(raw, fallbackDate) {
  const s = String(raw ?? "").trim();
  if (VALID_STATUS.some((re) => re.test(s))) return { status: s, nuance: null };

  let m = /^Resolved\s*\((\d{4}-\d{2}-\d{2})\)\s*—\s*(.+)$/.exec(s);
  if (m) return { status: `Closed (${m[1]}) — ${m[2]}`, nuance: null };
  m = /^Resolved\s*\((.+)\)\s*$/.exec(s);
  if (m) return { status: `Closed (${fallbackDate}) — ${m[1]}`, nuance: null };

  m = /^(Open|Mitigated|Active|Closed)\s*\((.+?)\)\s*(?:—\s*(.+))?$/.exec(s);
  if (m) {
    const inner = m[2];
    const tail = m[3] ? ` — ${m[3]}` : "";
    if (m[1] === "Closed") return { status: `Closed (${fallbackDate}) — ${inner}${tail}`, nuance: null };
    if (/mitigated by design/i.test(inner) || m[1] === "Mitigated")
      return { status: "Mitigated", nuance: `${inner}${tail}` };
    if (DEFERRED_HINT.test(inner)) return { status: `Deferred (${inner})`, nuance: tail ? m[3] : null };
    return { status: "Active", nuance: `${inner}${tail}` };
  }
  return { status: "Active", nuance: s || null };
}

function anchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
}

// The nuance is appended to Mitigation rather than dropped: "not fixable from this repository"
// was the single most useful thing several old status lines said.
function applyNuance(lines, nuance, fallbackDate) {
  if (!nuance) return lines;
  const sentence = `Status nuance (migrated ${fallbackDate}): ${nuance}`;
  if (lines.some((l) => l.includes(sentence))) return lines;
  const start = lines.findIndex((l) => /^-\s+\*\*Mitigation:\*\*/.test(l));
  if (start === -1) return [...lines, `- **Mitigation:** ${sentence}`];
  // A field is its bullet plus every wrapped continuation line under it. Appending to the FIRST
  // line splices the sentence into the middle of whatever the field was saying.
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].trim() && !/^\s*-\s+\*\*/.test(lines[end + 1])) end += 1;
  const out = [...lines];
  out[end] = `${out[end].replace(/\s*$/, "")} ${sentence}`;
  return out;
}

export function normalizeRegister({ entries }, { fallbackDate }) {
  const migrated = entries.map((e) => {
    const { status, nuance } = migrateStatus(e.status, fallbackDate);
    const lines = applyNuance(
      e.lines.map((l) => (STATUS.test(l) ? `- **Status:** ${status}` : l)).filter((l, i, a) => !(l === "" && a[i - 1] === "")),
      nuance,
      fallbackDate,
    );
    return { ...e, status, lines };
  });

  const bySection = new Map(SECTIONS.map((s) => [s, []]));
  for (const e of migrated) bySection.get(sectionFor(e.status)).push(e);
  for (const list of bySection.values())
    list.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.num - b.num);

  const toc = ["## Contents", ""];
  for (const s of SECTIONS) {
    toc.push(`### ${s}`);
    const list = bySection.get(s);
    if (!list.length) toc.push("- _none_");
    for (const e of list) toc.push(`- [${e.id} — ${e.title}](#${anchor(`${e.id} — ${e.title}`)})`);
    toc.push("");
  }

  const body = [];
  for (const s of SECTIONS) {
    body.push(`## ${s}`);
    for (const e of bySection.get(s)) {
      body.push(`### ${e.id} — ${e.title}`);
      body.push(...e.lines.join("\n").replace(/\n+$/, "").split("\n"));
      body.push("");
    }
  }

  return ["# Risk Register", "", ...toc, ...body].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}
