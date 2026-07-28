// Pure half of /up-update: version comparison, repository identity, report formatting.
//
// A2 (design decision, 2026-07-27): the command works through GitHub and NEVER through a local
// checkout, and nothing in it writes user-scope state. This module therefore reads nothing - no
// filesystem, no home directory, no cwd. A test asserts that structurally, because "we decided not
// to cache" is one convenience commit away from being false.
export const DEFAULTS = Object.freeze({
  owner: "axazolai",
  repo: "ultrapowers",
  upstream: "obra/superpowers",
  patchBranch: "patch",
});

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

export function parseVersion(s) {
  const m = SEMVER.exec(String(s ?? "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

function ordered(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function compareVersions(upstreamLatest, originalTag) {
  const latest = parseVersion(upstreamLatest);
  const have = parseVersion(String(originalTag ?? "").replace(/^upstream\//, ""));
  if (!latest || !have) {
    return {
      current: false,
      behind: false,
      problem: `cannot parse ${!latest ? `upstream release tag "${upstreamLatest}"` : `recorded base tag "${originalTag}"`}`,
    };
  }
  const out = { have: fmt(have), latest: fmt(latest), prerelease: Boolean(latest.pre) };
  if (latest.pre) return { ...out, current: ordered(latest, have) <= 0, behind: false };
  const delta = ordered(latest, have);
  return { ...out, current: delta === 0, behind: delta > 0 };
}

function fmt(v) {
  return `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;
}

export function latestUpstreamTag(tags) {
  const parsed = (tags ?? [])
    .filter((t) => t.startsWith("upstream/"))
    .map((t) => ({ tag: t, v: parseVersion(t.slice("upstream/".length)) }))
    .filter((e) => e.v);
  if (!parsed.length) return null;
  return parsed.sort((a, b) => ordered(b.v, a.v))[0].tag;
}

export function resolveRepo(argv = []) {
  const out = { ...DEFAULTS };
  const i = argv.indexOf("--repo");
  if (i !== -1) {
    const value = argv[i + 1];
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(value ?? "");
    if (!m) throw new Error(`--repo takes owner/name (got ${value === undefined ? "nothing" : `"${value}"`})`);
    out.owner = m[1];
    out.repo = m[2];
  }
  // Explicit remote overrides. These exist so the refusal paths can be exercised against a scratch
  // remote instead of the real repository - a rebuild that has never been watched fail is a rebuild
  // nobody should trust. They take a URL or a local path, so no GitHub round trip is implied.
  for (const [flag, key] of [["--fork-url", "forkUrl"], ["--upstream-url", "upstreamUrl"]]) {
    const k = argv.indexOf(flag);
    if (k === -1) continue;
    if (!argv[k + 1] || argv[k + 1].startsWith("--")) throw new Error(`${flag} takes a URL or path`);
    out[key] = argv[k + 1];
  }
  const j = argv.indexOf("--upstream");
  if (j !== -1) {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(argv[j + 1] ?? "");
    if (!m) throw new Error(`--upstream takes owner/name (got "${argv[j + 1]}")`);
    out.upstream = `${m[1]}/${m[2]}`;
  }
  return out;
}

export function formatReport({ repo, version, legal = [], deltas = [] }) {
  const lines = [
    "ultrapowers",
    `  fork        ${repo.owner}/${repo.repo}`,
    `  upstream    ${repo.upstream}`,
  ];
  if (version.problem) {
    lines.push(`  built from  ${version.have ?? "?"}`, `  status      cannot tell: ${version.problem}`);
  } else if (version.behind) {
    lines.push(`  built from  ${version.have}`, `  latest      ${version.latest}`, `  status      BEHIND - upstream ${version.latest} is newer than the recorded base ${version.have}`);
  } else if (version.prerelease) {
    lines.push(`  built from  ${version.have}`, `  latest      ${version.latest} (pre-release, ignored)`, "  status      up to date");
  } else {
    lines.push(`  built from  ${version.have}`, "  status      up to date");
  }
  if (legal.length) {
    lines.push("", "  Held back for legal reasons - never renamed, asserted on every build:");
    for (const e of legal) lines.push(`    ${e.path}`, `      ${e.reason}`);
  }
  if (deltas.length) {
    lines.push("", `  Deltas carried (${deltas.length}):`);
    for (const d of deltas) lines.push(`    ${d}`);
  }
  return lines.join("\n");
}

// Pure verdict over facts someone else gathered. All git and network work happens in up-update.mjs;
// keeping this pure is what makes the refusal conditions testable without a fork checkout.
//
// Every condition contributes its own reason and none of them short-circuit: a run that is broken
// three ways should say so once, not three times in a row as each is fixed.
export function assess({ buildResult, upstreamDiff, mainDrift = [], cfg }) {
  const reasons = [];
  const t = cfg?.thresholds ?? {};
  const b = buildResult ?? {};
  const drift = b.mapDrift ?? {};

  if (b.failures?.length) {
    for (const f of b.failures) reasons.push(`delta did not apply: ${f.name} - ${f.detail}`);
  } else if (b.failed?.length) {
    reasons.push(`delta(s) did not apply: ${b.failed.join(", ")}`);
  }

  if (b.residual?.length) {
    const shown = [...new Set(b.residual.map((r) => `${r.path}: ${r.text}`))].slice(0, 10);
    reasons.push(`${b.residual.length} upstream-name occurrence(s) survived outside the protected slug: ${shown.join("; ")}`);
  }

  const pct = upstreamDiff?.changedPct;
  const max = t.changedFilesPct;
  if (typeof pct === "number" && typeof max === "number" && pct > max) {
    reasons.push(`upstream changed ${pct}% of the tracked files, over the ${max}% threshold - read the diff by hand before trusting a rebuild`);
  }

  if (mainDrift.length) {
    reasons.push(`main does not match a fresh build (${mainDrift.length} file(s): ${mainDrift.slice(0, 10).join(", ")}) - main is generated, so this is a defect rather than an edit`);
  }

  if (t.unclassifiedRefuses && drift.unclassified?.length) {
    reasons.push(`${drift.unclassified.length} upstream path(s) no rule covers: ${drift.unclassified.join(", ")} - classify them in transform/inventory.json first`);
  }
  if (drift.added?.length) {
    reasons.push(`${drift.added.length} new upstream path(s) absent from the manifest: ${drift.added.map((a) => `${a.path} (rule proposes: ${a.proposed})`).join(", ")} - record a decision for each`);
  }
  if (drift.removed?.length) {
    reasons.push(`${drift.removed.length} manifest path(s) upstream no longer ships: ${drift.removed.join(", ")}`);
  }
  if (drift.reclassified?.length) {
    reasons.push(`${drift.reclassified.length} path(s) changed class: ${drift.reclassified.map((e) => `${e.path} ${e.was} -> ${e.now}`).join(", ")}`);
  }

  if (t.attributionMissingRefuses) {
    for (const a of b.attributionMissing ?? []) reasons.push(`attribution: ${a.detail} (${a.reason})`);
  }

  return { verdict: reasons.length ? "needs-work" : "ok", reasons, obsolete: b.obsolete ?? [] };
}

export function formatAssessment(a, { have, latest } = {}) {
  const lines = [`rebuild against upstream ${latest ?? "?"} (was ${have ?? "?"}): ${a.verdict === "ok" ? "OK" : "NEEDS WORK"}`];
  for (const r of a.reasons) lines.push(`  REFUSE  ${r}`);
  for (const o of a.obsolete) {
    lines.push(`  OBSOLETE  ${o} - upstream has since made this change itself. Reported, not dropped:`);
    lines.push("            removing a delta is a decision, and carrying a dead one is how forks rot.");
  }
  return lines.join("\n");
}
