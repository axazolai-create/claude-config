#!/usr/bin/env node
// /up-update - keep the ultrapowers fork current with obra/superpowers.
//
// A2: this command works through GitHub and never through a local checkout. There is no
// configuration file and no state anywhere under ~/.claude - identity lives in up-update-lib's
// constants, overridable per run with --repo. It is runnable from any directory, and a development
// checkout of the fork (if one exists at all) is neither read nor written.
//
// `check` is read-only and cheap: `git ls-remote` for the tags, plus three HTTPS reads. It never
// clones. The rebuilding half (Task 9) is what takes a scratch clone in a temp directory.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareVersions, resolveRepo, latestUpstreamTag, formatReport, assess, formatAssessment } from "./lib/up-update-lib.mjs";

export const realFetchers = {
  listRemoteTags(url) {
    const r = spawnSync("git", ["ls-remote", "--tags", "--refs", url], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ls-remote failed for ${url}: ${(r.stderr || "").trim()}`);
    return r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t")[1].replace(/^refs\/tags\//, ""));
  },
  async latestRelease(upstream) {
    const res = await fetch(`https://api.github.com/repos/${upstream}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ultrapowers-up-update" },
    });
    if (!res.ok) throw new Error(`GitHub releases API returned ${res.status} for ${upstream}`);
    return (await res.json()).tag_name;
  },
  async rawFile(owner, repo, branch, path) {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, {
      headers: { "user-agent": "ultrapowers-up-update" },
    });
    if (!res.ok) throw new Error(`cannot read ${path} from ${owner}/${repo}@${branch} (HTTP ${res.status})`);
    return res.text();
  },
  async listDir(owner, repo, branch, path) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ultrapowers-up-update" },
    });
    if (!res.ok) return [];
    return (await res.json()).filter((e) => e.type === "file").map((e) => e.name);
  },
};

export function legalEntries(config, inventory) {
  const out = [];
  for (const rule of inventory?.rules ?? []) {
    if (rule.mode === "verbatim") out.push({ path: rule.match, reason: rule.reason });
  }
  for (const req of config?.attribution?.require ?? []) {
    out.push({ path: req.path, reason: req.reason });
  }
  return out;
}

export async function check(argv = [], fetchers = realFetchers) {
  const repo = resolveRepo(argv);
  const forkUrl = repo.forkUrl ?? `https://github.com/${repo.owner}/${repo.repo}.git`;
  const baseTag = latestUpstreamTag(fetchers.listRemoteTags(forkUrl));
  if (!baseTag) {
    return { repo, version: { current: false, behind: false, problem: `${repo.owner}/${repo.repo} has no upstream/* tag - nothing records which base main was built from` }, legal: [], deltas: [] };
  }
  const [latest, config, inventory, deltas] = await Promise.all([
    fetchers.latestRelease(repo.upstream),
    fetchers.rawFile(repo.owner, repo.repo, repo.patchBranch, "transform/config.json").then(JSON.parse).catch(() => null),
    fetchers.rawFile(repo.owner, repo.repo, repo.patchBranch, "transform/inventory.json").then(JSON.parse).catch(() => null),
    fetchers.listDir(repo.owner, repo.repo, repo.patchBranch, "transform/deltas").catch(() => []),
  ]);
  return {
    repo,
    version: compareVersions(latest, baseTag),
    legal: legalEntries(config, inventory),
    deltas: deltas.filter((n) => n.endsWith(".patch")).sort(),
  };
}

// ------------------------------------------------------------------------------------------------
// update: fetch, rebuild, assess, refuse.
//
// Everything happens in a throwaway clone in an OS temp directory. A refused run is therefore
// indistinguishable from a run that never happened - there is no cleanup logic to get wrong, which
// is the main reason this beats a cached mirror despite being slower.
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})\n${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout ?? "";
}

function facts(dir) {
  const r = spawnSync("node", ["transform/build-cli.mjs", "facts"], { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (!r.stdout?.trim()) throw new Error(`the fork's build produced no facts (exit ${r.status})\n${(r.stderr || "").trim()}`);
  return JSON.parse(r.stdout);
}

function trackedChangedPct(dir, oldTree, newTree, manifest) {
  const tracked = new Set(Object.entries(manifest).filter(([, c]) => c === "tracked").map(([p]) => p));
  if (!tracked.size) return 0;
  const changed = run("git", ["-C", dir, "diff", "--name-only", oldTree, newTree]).split("\n").filter(Boolean);
  const hits = changed.filter((p) => tracked.has(p));
  return { changedPct: Math.round((hits.length / tracked.size) * 100), trackedChanged: hits };
}

export async function update(argv = [], fetchers = realFetchers) {
  const repo = resolveRepo(argv);
  const publish = argv.includes("--publish");
  const temp = mkdtempSync(join(tmpdir(), "up-update-"));
  let keep = false;
  try {
    // core.autocrlf must be off from the very first checkout, not set afterwards: the deltas and the
    // fork-owned files are read from the working tree, and a CRLF checkout makes every delta's
    // context fail to match for a reason that has nothing to do with upstream.
    run("git", ["clone", "--quiet", "-c", "core.autocrlf=false", "-c", "core.eol=lf",
      repo.forkUrl ?? `https://github.com/${repo.owner}/${repo.repo}.git`, temp]);
    run("git", ["-C", temp, "checkout", "--quiet", repo.patchBranch]);
    // The clone already carries every branch as a remote-tracking ref plus all tags. Local branches
    // are made from those rather than re-fetched, because fetching into the checked-out branch is
    // refused outright.
    for (const b of ["original", "main"]) run("git", ["-C", temp, "branch", "-f", b, `origin/${b}`]);

    // Drift is checked against the CURRENT base, before anything moves. Afterwards every file
    // legitimately differs, and the check would fire on every update instead of on a hand edit.
    const before = facts(temp);
    if (before.mainDrift.length) {
      console.error(formatAssessment(assess({ buildResult: before, upstreamDiff: { changedPct: 0 }, mainDrift: before.mainDrift, cfg: { thresholds: before.thresholds } })));
      return 1;
    }

    const latestTag = await fetchers.latestRelease(repo.upstream);
    const version = compareVersions(latestTag, before.originalTag);
    if (version.problem) { console.error(`cannot proceed: ${version.problem}`); return 1; }
    if (!version.behind && !argv.includes("--force")) {
      console.log(`already built from the latest upstream release (${version.have}); nothing to do.`);
      return 0;
    }

    run("git", ["-C", temp, "remote", "add", "upstream", repo.upstreamUrl ?? `https://github.com/${repo.upstream}.git`]);
    run("git", ["-C", temp, "fetch", "--quiet", "--no-tags", "upstream", `refs/tags/${latestTag}:refs/tags/upstream-src/${latestTag}`]);
    const newTree = run("git", ["-C", temp, "rev-parse", `refs/tags/upstream-src/${latestTag}^{tree}`]).trim();
    const newTag = `upstream/${version.latest}`;
    const commit = run("git", ["-C", temp, "commit-tree", newTree], {
      input: `original: upstream ${repo.upstream} ${latestTag} (verbatim)\n\nRecorded by /up-update. Orphan-rooted: one commit per upstream release.\n`,
    }).trim();
    run("git", ["-C", temp, "branch", "-f", "original", commit]);
    run("git", ["-C", temp, "tag", "-f", newTag, commit]);

    const cfgPath = join(temp, "transform", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const oldTree = cfg.originalTree;
    cfg.originalTag = newTag;
    cfg.originalTree = newTree;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");

    const after = facts(temp);
    const upstreamDiff = trackedChangedPct(temp, oldTree, newTree, JSON.parse(readFileSync(join(temp, "transform", "inventory.json"), "utf8")).manifest);
    const verdict = assess({ buildResult: after, upstreamDiff, mainDrift: [], cfg: { thresholds: after.thresholds } });

    console.log(formatAssessment(verdict, { have: version.have, latest: version.latest }));
    console.log(`\n  upstream touched ${upstreamDiff.changedPct}% of tracked files (${upstreamDiff.trackedChanged.length} of them)`);
    if (verdict.verdict === "needs-work") {
      console.error("\nRefusing. Nothing was published and the working clone is discarded - this run left no trace.");
      return 1;
    }

    run("git", ["-C", temp, "add", "-A"]);
    run("git", ["-C", temp, "commit", "--quiet", "-m", `transform: rebase onto upstream ${version.latest}`]);
    run("node", ["transform/build-cli.mjs", "commit"], { cwd: temp });
    const pending = run("git", ["-C", temp, "log", "--oneline", "origin/main..main"]).trim();
    console.log(`\n  prepared, not published:\n    version   ${before.version} -> ${after.version}`);
    console.log(`    main      ${pending.split("\n").length} new commit(s)\n    original  ${newTag}`);

    if (!publish) {
      keep = true;
      console.log(`\n  Nothing has been pushed. Review, then re-run with --publish to release.`);
      console.log(`  Working clone kept for inspection: ${temp}`);
      return 0;
    }
    run("git", ["-C", temp, "push", "--quiet", "origin", "patch", "main", "original"]);
    run("git", ["-C", temp, "push", "--quiet", "origin", newTag]);
    console.log(`\n  published. The plugin is NOT deployed by this - run /plugin update on each machine.`);
    return 0;
  } finally {
    if (!keep) rmSync(temp, { recursive: true, force: true });
  }
}

export async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith("--")) || "check";
  if (cmd === "update") return update(argv);
  if (cmd !== "check" && cmd !== "status") {
    console.error(`unknown command "${cmd}". Available: check (alias: status), update.`);
    return 2;
  }
  const assessment = await check(argv);
  console.log(formatReport(assessment));
  if (assessment.version.problem) return 1;
  if (assessment.version.behind) {
    console.log("\n  Next: /up-update update - rebuilds against the new upstream in a throwaway clone,");
    console.log("  then refuses, or prepares and stops. Nothing is pushed without --publish.");
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
