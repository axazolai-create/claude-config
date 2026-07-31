const FILE = /^(\d{4})-[a-z0-9-]+\.md$/;
const SECTIONS = ["## Context", "## Decision", "## Consequences"];

export function nextAdrNumber(filenames) {
  const nums = filenames.map((n) => FILE.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
}

export function adrTemplate({ number, title, date }) {
  return `---
status: proposed
date: ${date}
---

# ADR-${number} ${title}

## Context

## Decision

## Consequences
`;
}

export function lintAdr(text, filename) {
  const problems = [];
  const m = FILE.exec(filename);
  if (!m) return [{ file: filename, problem: "filename must be NNNN-kebab-slug.md" }];
  if (!/^---\n(?:.*\n)*?status:\s*\S+/m.test(text)) problems.push({ file: filename, problem: "no `status:` field in the frontmatter" });
  const head = /^# ADR-(\d{4}) (.+)$/m.exec(text);
  if (!head) problems.push({ file: filename, problem: "no `# ADR-NNNN Title` heading" });
  else if (head[1] !== m[1]) problems.push({ file: filename, problem: `heading says ADR-${head[1]}, filename says ${m[1]}` });
  for (const s of SECTIONS)
    if (!new RegExp(`^${s}$`, "m").test(text)) problems.push({ file: filename, problem: `missing section ${s}` });
  return problems;
}

// Both directions: an ADR naming a risk that does not exist is as broken as a risk naming an
// ADR that does not exist, and only one of the two is caught by linting the register.
export function lintCrossRefs({ adrs, riskIds }) {
  const problems = [];
  const knownRisks = new Set(riskIds);
  const knownAdrs = new Set(adrs.map((a) => a.id));
  for (const a of adrs) {
    for (const m of a.text.matchAll(/\bRISK-[A-Z0-9]+-\d+\b/g))
      if (!knownRisks.has(m[0])) problems.push({ file: a.file, problem: `dangling reference to ${m[0]}` });
    for (const m of a.text.matchAll(/\bADR-(\d{4})\b/g))
      if (`ADR-${m[1]}` !== a.id && !knownAdrs.has(`ADR-${m[1]}`))
        problems.push({ file: a.file, problem: `dangling reference to ADR-${m[1]}` });
  }
  return problems;
}
