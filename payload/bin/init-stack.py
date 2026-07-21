#!/usr/bin/env python3
"""
init-stack: detect this project's stack, classify each stack plugin's state, and
(optionally) merge the matching settings from the resolved chain under
~/.claude/setting-templates/ (see STACK_PATHS below for the id -> path mapping)
into the project's ./.claude/settings.json.

Plugin states:
  installed           -> in ~/.claude/plugins/installed_plugins.json
  available           -> not installed, marketplace added, plugin listed in its catalog
  marketplace_missing -> not installed, the plugin's @marketplace is not added
  unavailable         -> not installed, marketplace added but plugin not in catalog (stale/wrong id)
  placeholder         -> id still contains <...>

Modes:
  (no args)            detect + classify + report (human + STATUS_JSON). Writes nothing.
  --status <id>        print {"id","state"} JSON for one plugin (used to re-check). No writes.
  -i / --interactive   TUI: lists the detected stack's plugins (installed vs needs-install) plus
                       every other known plugin (opt-in, with description); on confirm it INSTALLS
                       the chosen missing ones (`claude plugin install`) and activates them in the
                       project. Needs a real terminal. Writes.
  --enable <id...>     enable exactly the given ids in project settings (+ non-plugin keys). Writes.
  --remove <id...>     delete the given ids from project enabledPlugins. Writes.
                       (--enable and --remove may be combined in one call.)
  --apply-all          enable every non-placeholder declared plugin (no removals; no install). Writes.

enabledPlugins is resolved at Claude Code STARTUP; restart after --apply.
"""
from __future__ import annotations
import fnmatch
import json
import os
import subprocess
import sys
import time
from pathlib import Path

def _force_utf8_stdio() -> None:
    # Windows consoles under a Cyrillic code page (cp1251/cp866) cannot encode characters like
    # check/cross/box glyphs; writing them raises UnicodeEncodeError. Force UTF-8 (with safe
    # replacement) so output never crashes regardless of the active console code page.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


ROOT = Path.cwd()
HOME = Path.home()
SETTINGS = ROOT / ".claude" / "settings.json"
PLUGINS_DIR = HOME / ".claude" / "plugins"
TEMPLATES_DIR = HOME / ".claude" / "setting-templates"
INSTALLED_FILE = PLUGINS_DIR / "installed_plugins.json"
KNOWN_MP_FILE = PLUGINS_DIR / "known_marketplaces.json"
MARKETPLACES_DIR = PLUGINS_DIR / "marketplaces"
PRUNE = {".git", "node_modules", ".venv", "venv", "dist", "build",
         "__pycache__", ".next", "target", ".gradle", ".idea", "obj", "bin"}


# ---------- io ----------
def _read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(_read_text(path) or "{}")
    except json.JSONDecodeError as e:
        print(f"! {path} is not valid JSON: {e}", file=sys.stderr)
        sys.exit(2)


def is_placeholder(s: str) -> bool:
    return "<" in s or ">" in s


def split_id(pid: str) -> tuple[str, str]:
    name, _, mp = pid.rpartition("@")
    return name, mp


def grab(args: list[str], flag: str) -> list[str]:
    """Collect tokens after `flag` until the next --flag."""
    if flag not in args:
        return []
    i = args.index(flag) + 1
    out: list[str] = []
    while i < len(args) and not args[i].startswith("--"):
        out.append(args[i])
        i += 1
    return out


# ---------- stack detection ----------
def _node_deps() -> set[str]:
    pkg = ROOT / "package.json"
    if not pkg.exists():
        return set()
    try:
        data = json.loads(_read_text(pkg) or "{}")
    except Exception:
        return set()
    deps: dict[str, str] = {}
    for k in ("dependencies", "devDependencies", "peerDependencies"):
        deps.update(data.get(k, {}) or {})
    return set(deps.keys())


def _py_requirements() -> str:
    text = _read_text(ROOT / "pyproject.toml")
    for req in ROOT.glob("requirements*.txt"):
        text += "\n" + _read_text(req)
    return text.lower()


def _csproj_texts() -> list[str]:
    # One lowered text per .csproj - classified INDEPENDENTLY (RISK-DETECT-001). Pooling all
    # csproj text into one string let a single web/desktop project suppress a genuine console
    # app's csharp-cli tag, and made separate projects indistinguishable.
    texts: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        for fn in filenames:
            if fn.endswith(".csproj"):
                texts.append(_read_text(Path(dirpath) / fn).lower())
    return texts


def _glob_any(*patterns: str) -> bool:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        for fn in filenames:
            if any(fnmatch.fnmatch(fn, pat) for pat in patterns):
                return True
    return False


def _glob_any_dir(*patterns: str) -> bool:
    """Same as _glob_any but matches directory NAMES, not filenames - needed for signals like
    an Xcode project (`MyApp.xcodeproj/`), which is a directory, not a file."""
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        for dn in dirnames:
            if any(fnmatch.fnmatch(dn, pat) for pat in patterns):
                return True
    return False


def detect() -> list[str]:
    found: list[str] = []
    node = _node_deps()
    if "@nestjs/core" in node or (ROOT / "nest-cli.json").exists():
        found.append("nest")
    if "next" in node or _glob_any("next.config.*"):
        found.append("next")
    # react-native/Expo checked BEFORE plain "react" (react-native itself depends on react, so
    # without this ordering an RN project would get double-tagged as both "react" and
    # "react-native"). Expo apps in managed workflow may not ship metro.config.*, so the "expo"
    # dep and app.config.{js,ts} are checked too, not just metro.config.*.
    if ("react-native" in node or "expo" in node
            or _glob_any("metro.config.js", "metro.config.ts", "metro.config.mjs",
                         "app.config.js", "app.config.ts")):
        found.append("react-native")
    elif "react" in node:
        found.append("react")
    # Bare "node" stack: package.json exists but no frontend/backend framework matched above -
    # a plain Node/TS script, library, or unopinionated backend. Mirrors "sql": "DB/_base.json"
    # (see STACK_PATHS) - reuses the direction's own _base.json as a framework-less leaf.
    if node and not any(s in found for s in ("nest", "next", "react", "react-native")):
        found.append("node")
    py = _py_requirements()
    if "django" in py or (ROOT / "manage.py").exists():
        found.append("django")
    if "fastapi" in py:
        found.append("fastapi")
    if "flask" in py:
        found.append("flask")
    if _glob_any("*.kt", "*.kts", "build.gradle.kts"):
        found.append("kotlin")
    # Android is its own stack (extends the "mobile" direction), separate from generic
    # Kotlin/JVM (a Kotlin/Ktor backend service is not mobile) - gated on the one signal that's
    # actually Android-specific rather than "any Kotlin file exists".
    if _glob_any("AndroidManifest.xml"):
        found.append("android")
    # Flutter checked before Swift: a Flutter/RN repo's vendored ios/ folder also contains a
    # native Xcode project + Info.plist, which would otherwise false-positive as a standalone
    # native-iOS ("swift") project. Only tag "swift" when this ISN'T already Flutter or RN.
    if (ROOT / "pubspec.yaml").exists():
        found.append("dart")
    if "dart" not in found and "react-native" not in found and (
            _glob_any("Package.swift") or _glob_any_dir("*.xcodeproj", "*.xcworkspace")):
        found.append("swift")
    if (ROOT / "turbo.json").exists():
        found.append("turbo")
    if (ROOT / "nx.json").exists():
        found.append("nx")
    node_bot_libs = {"telegraf", "grammy", "node-telegram-bot-api"}
    if node & node_bot_libs:
        found.append("telegram-node")
    if any(lib in py for lib in ("aiogram", "python-telegram-bot", "pytelegrambotapi")):
        found.append("telegram-python")
    # Bare "python" stack: pyproject.toml/requirements*.txt exists but no framework or bot lib
    # matched above - a plain script, library, or unopinionated backend. Same fallback pattern
    # as "node" above.
    if py and not any(s in found for s in ("django", "fastapi", "flask", "telegram-python")):
        found.append("python")
    cs_texts = _csproj_texts()
    has_xaml = _glob_any("*.xaml")
    if cs_texts:
        # Classify each project on its OWN csproj text, then union (dedup happens at return).
        for cs in cs_texts:
            is_web = 'sdk="microsoft.net.sdk.web"' in cs or "microsoft.aspnetcore" in cs
            is_desktop = "<usewpf>true" in cs or "<usewindowsforms>true" in cs
            is_exe = "outputtype>exe" in cs
            if is_web:
                found.append("aspnet")
            if is_desktop:
                found.append("wpf")
            if is_exe and not is_web and not is_desktop:
                found.append("csharp-cli")
            if not (is_web or is_desktop or is_exe):
                found.append("csharp")
        if has_xaml and "wpf" not in found:  # repo-level XAML implies WPF even w/o a UseWPF flag
            found.append("wpf")
    elif has_xaml or _glob_any("*.cs"):
        found.append("wpf" if has_xaml else "csharp")
    if _glob_any("*.sql"):
        found.append("sql")
    seen: set[str] = set()
    return [s for s in found if not (s in seen or seen.add(s))]


# ---------- plugin / marketplace state ----------
def installed_ids() -> set[str]:
    data = load_json(INSTALLED_FILE)
    plugins = data.get("plugins", {})
    return set(plugins.keys()) if isinstance(plugins, dict) else set()


def known_marketplaces() -> set[str]:
    names: set[str] = set()
    if MARKETPLACES_DIR.exists():
        names |= {p.name for p in MARKETPLACES_DIR.iterdir() if p.is_dir()}
    km = load_json(KNOWN_MP_FILE)
    mps = km.get("marketplaces", km) if isinstance(km, dict) else {}
    if isinstance(mps, dict):
        names |= set(mps.keys())
    elif isinstance(mps, list):
        names |= {e.get("name") for e in mps if isinstance(e, dict) and e.get("name")}
    return {n for n in names if n}


def catalog_has(mp: str, name: str) -> bool:
    base = MARKETPLACES_DIR / mp
    for cand in (base / ".claude-plugin" / "marketplace.json",
                 base / "marketplace.json"):
        if cand.exists():
            data = load_json(cand)
            for p in data.get("plugins", []) or []:
                if isinstance(p, dict) and p.get("name") == name:
                    return True
    return False


def classify(pid: str, installed: set[str], known: set[str]) -> str:
    if is_placeholder(pid):
        return "placeholder"
    if pid in installed:
        return "installed"
    name, mp = split_id(pid)
    if mp not in known:
        return "marketplace_missing"
    if catalog_has(mp, name):
        return "available"
    return "unavailable"


def commands_for(state: str, pid: str, install_block: dict) -> dict | None:
    if state in ("installed", "placeholder"):
        return None
    name, mp = split_id(pid)
    ma = install_block.get("marketplace_add", {}) or {}
    out: dict = {
        "install": {k: install_block.get(k) for k in ("cmd", "bash", "slash")
                    if install_block.get(k)},
    }
    if state == "marketplace_missing":
        out["marketplace_add"] = {k: ma.get(k) for k in ("cmd", "slash") if ma.get(k)}
    if state == "unavailable":
        out["refresh"] = {
            "cmd": f"claude plugin marketplace update {mp}",
            "slash": f"/plugin marketplace update {mp}",
        }
    return out


# ---------- present (currently enabled in project settings) ----------
def present_enabled() -> list[str]:
    s = load_json(SETTINGS)
    ep = s.get("enabledPlugins", {})
    return list(ep.keys()) if isinstance(ep, dict) else []


# ---------- merge ----------
def clean_nonplugin(block: dict) -> dict:
    out: dict = {}
    for k, v in block.items():
        if k.startswith("_") or k == "enabledPlugins":
            continue
        out[k] = v
    return out


def deep_merge(dst: dict, src: dict) -> dict:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        elif isinstance(v, list) and isinstance(dst.get(k), list):
            # Union, order-preserving, deduped (RISK-SETTINGS-001): a template array (e.g.
            # permissions.allow) must ADD to a user-set array, not replace it wholesale.
            merged = list(dst[k])
            seen = {json.dumps(x, sort_keys=True) for x in merged}
            for x in v:
                key = json.dumps(x, sort_keys=True)
                if key not in seen:
                    seen.add(key)
                    merged.append(x)
            dst[k] = merged
        else:
            dst[k] = v
    return dst


# ---- RISK-SETTINGS-001: cross-process lock + atomic write for the shared settings.json the
# Node hooks also mutate. Same `<target>.lock` filename convention as hooks/lib/atomic-json.mjs
# so this Python command and the JS hooks mutually exclude. ----
_LOCK_STALE_S = 15.0
_LOCK_MAX_WAIT_S = 5.0


def _acquire_lock(target: Path):
    lock = target.with_name(target.name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + _LOCK_MAX_WAIT_S
    while True:
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            try:
                os.write(fd, str(os.getpid()).encode())
            finally:
                os.close(fd)
            return lock
        except FileExistsError:
            try:
                stale = (time.time() - lock.stat().st_mtime) > _LOCK_STALE_S
            except OSError:
                stale = True
            if stale:
                try:
                    lock.unlink()
                except OSError:
                    pass
                continue
            if time.time() > deadline:
                return None  # proceed unlocked rather than fail the command
            time.sleep(0.05)
        except OSError:
            return None  # can't create the lock (perms) - proceed unlocked


def _release_lock(lock) -> None:
    if lock is not None:
        try:
            lock.unlink()
        except OSError:
            pass


def _write_atomic(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.tmp-{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    os.replace(str(tmp), str(target))  # atomic; replaces an existing target on Windows too


# ---------- detector-id -> template path (paths no longer mirror the id 1:1 - see
# setting-templates/README.md) ----------
STACK_PATHS: dict[str, str] = {
    "react": "frontend/react.json",
    "next": "frontend/next.json",
    "react-native": "frontend/react-native.json",
    "nest": "backend/node/nest.json",
    "node": "backend/node/_base.json",
    "django": "backend/python/django.json",
    "fastapi": "backend/python/fastapi.json",
    "flask": "backend/python/flask.json",
    "python": "backend/python/_base.json",
    "android": "mobile/android.json",
    "swift": "mobile/swift.json",
    "dart": "mobile/dart.json",
    "kotlin": "CLI/kotlin.json",
    "sql": "DB/_base.json",
    "turbo": "monorepo/turbo.json",
    "nx": "monorepo/nx.json",
    "telegram-node": "bots/node.json",
    "telegram-python": "bots/python.json",
    "csharp": "backend/csharp/_base.json",
    "aspnet": "backend/csharp/aspnet.json",
    "csharp-cli": "CLI/csharp.json",
    "wpf": "desktop/wpf.json",
}


# ---------- extends resolution (vertical directory inheritance + explicit cross-branch extends) ----------
def _vertical_ancestors(rel_path: str) -> list[str]:
    """Ancestor `_base.json` relative paths for a template at rel_path, root-most first, excluding
    rel_path itself (e.g. "backend/node/nest.json" -> ["_base.json", "backend/_base.json",
    "backend/node/_base.json"]; "backend/node/_base.json" itself -> ["_base.json",
    "backend/_base.json"])."""
    dirs = rel_path.replace("\\", "/").split("/")[:-1]
    out: list[str] = []
    for i in range(len(dirs) + 1):
        candidate = "/".join(dirs[:i] + ["_base.json"]) if i > 0 else "_base.json"
        if candidate != rel_path:
            out.append(candidate)
    return out


def _resolve_chain(rel_path: str, visited: set[str] | None = None) -> list[tuple[str, dict]]:
    """Return [(rel_path, tpl_dict), ...] in application order: vertical ancestors first
    (root-most first, via _vertical_ancestors), then each explicit `extends` target fully
    resolved (filtered down to `pick`'s listed top-level keys when declared for that path), then
    rel_path's own template LAST - so its own plugins/merge are what a diff would show as "added
    on top". Cycle-safe: `visited` is keyed by relative path, so a path already applied earlier in
    this resolution (e.g. the root _base.json, reachable both as a vertical ancestor and via some
    other branch's own vertical chain) is only ever applied once, and a template that (directly or
    via a cycle) extends itself is silently ignored rather than recursing forever."""
    if visited is None:
        visited = set()
    if rel_path in visited:
        return []
    visited.add(rel_path)
    tpl_path = TEMPLATES_DIR / rel_path
    if not tpl_path.exists():
        return []
    tpl = load_json(tpl_path)

    chain: list[tuple[str, dict]] = []
    for ancestor in _vertical_ancestors(rel_path):
        chain.extend(_resolve_chain(ancestor, visited))

    pick = tpl.get("pick", {}) or {}
    for parent in tpl.get("extends", []) or []:
        sub_chain = _resolve_chain(parent, visited)
        keys = pick.get(parent)
        if keys:
            sub_chain = [(label, {k: v for k, v in t.items() if k in keys}) for label, t in sub_chain]
        chain.extend(sub_chain)

    chain.append((rel_path, tpl))
    return chain


# ---------- gather declared plugins across detected stacks ----------
def gather(stacks: list[str]):
    """Return (entries, nonplugin_merge) where entries = list of dicts."""
    installed = installed_ids()
    known = known_marketplaces()
    entries: list[dict] = []
    nonplugin: dict = {}
    seen: set[str] = set()
    for stack in stacks:
        rel_path = STACK_PATHS.get(stack)
        if not rel_path or not (TEMPLATES_DIR / rel_path).exists():
            entries.append({"stack": stack, "via": stack, "id": None, "state": "no_template",
                            "commands": None})
            continue
        for via, tpl in _resolve_chain(rel_path):
            deep_merge(nonplugin, clean_nonplugin(tpl.get("merge", {}) or {}))
            for p in tpl.get("plugins", []) or []:
                pid = p.get("id", "")
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                state = classify(pid, installed, known)
                entries.append({
                    "stack": stack, "via": via, "id": pid, "state": state,
                    "description": p.get("description", ""),
                    "commands": commands_for(state, pid, p.get("install", {}) or {}),
                })
    return entries, nonplugin


# ---------- auto-enable set + full "known" plugin catalog (for interactive selection) ----------
def resolved_autoenable(stacks: list[str]) -> set[str]:
    """Ids the detected stacks' templates auto-enable (merge.enabledPlugins == True) across the
    full resolved inheritance chain, minus placeholders. Used to pre-check the right boxes in the
    interactive picker so the default selection matches what a plain --apply-all would enable."""
    ids: set[str] = set()
    for stack in stacks:
        rel_path = STACK_PATHS.get(stack)
        if not rel_path or not (TEMPLATES_DIR / rel_path).exists():
            continue
        for _via, tpl in _resolve_chain(rel_path):
            ep = (tpl.get("merge", {}) or {}).get("enabledPlugins", {}) or {}
            for pid, on in ep.items():
                if on and not is_placeholder(pid):
                    ids.add(pid)
    return ids


def known_plugins(exclude_ids: set[str]) -> list[dict]:
    """Every plugin declared ANYWHERE under setting-templates/ that isn't already in exclude_ids
    (the detected-stack set) - the "other known plugins" opt-in list. Deduped by id, classified,
    carrying description + install commands. Read straight off the template files (not the
    STACK_PATHS chain) so opt-in plugins that no stack auto-enables (e.g. auth0) still surface."""
    installed = installed_ids()
    known = known_marketplaces()
    out: list[dict] = []
    seen: set[str] = set()
    for tpl_path in sorted(TEMPLATES_DIR.rglob("*.json")):
        tpl = load_json(tpl_path)
        rel = tpl_path.relative_to(TEMPLATES_DIR).as_posix()
        for p in tpl.get("plugins", []) or []:
            pid = p.get("id", "")
            if not pid or pid in exclude_ids or pid in seen:
                continue
            seen.add(pid)
            state = classify(pid, installed, known)
            out.append({
                "stack": "known", "via": rel, "id": pid, "state": state, "group": "known",
                "description": p.get("description", ""),
                "commands": commands_for(state, pid, p.get("install", {}) or {}),
            })
    return out


# ---------- skills (npx skills add ...; SKILL.md dirs, NOT marketplace plugins) ----------
SKILLS_DIRS = [HOME / ".claude" / "skills", ROOT / ".claude" / "skills"]


def installed_skill_names() -> set[str]:
    names: set[str] = set()
    for d in SKILLS_DIRS:
        if d.exists():
            names |= {p.name for p in d.iterdir() if p.is_dir()}
    return names


def gather_skills(stacks: list[str]) -> list[dict]:
    """Skills declared by the detected stacks' templates (a template's optional skills[] array),
    deduped, each with a BEST-EFFORT present/missing state (present == a dir of its `name` exists in
    ~/.claude/skills or ./.claude/skills). Skills are npx-installed SKILL.md dirs, not plugins - there
    is no enable step and no installed_plugins.json equivalent, so detection is by directory name and
    is approximate (skill slugs/dir-names drift - the install command is the source of truth)."""
    present = installed_skill_names()
    out: list[dict] = []
    seen: set[str] = set()
    for stack in stacks:
        rel_path = STACK_PATHS.get(stack)
        if not rel_path or not (TEMPLATES_DIR / rel_path).exists():
            continue
        for _via, tpl in _resolve_chain(rel_path):
            for s in tpl.get("skills", []) or []:
                sid = s.get("id", "")
                if not sid or sid in seen:
                    continue
                seen.add(sid)
                nm = s.get("name", sid.split("/")[-1])
                out.append({
                    "id": sid, "name": nm, "stack": stack,
                    "state": "installed" if nm in present else "available",
                    "description": s.get("description", ""),
                    "install": s.get("install", {}) or {},
                })
    return out


def install_skills(entries: list[dict]) -> tuple[list[str], list[str]]:
    """Run `npx skills add <id>` for each chosen skill. Returns (succeeded, failed)."""
    ok: list[str] = []
    failed: list[str] = []
    for e in entries:
        cmd = (e.get("install", {}) or {}).get("cmd")
        if not cmd:
            print(f"  - {e['id']}: no install command (skipped)")
            failed.append(e["id"])
            continue
        print(f"  Installing skill {e['id']} ...")
        if _run_cmd(cmd)[0]:
            ok.append(e["id"])
        else:
            print(f"  ! {e['id']}: install failed", file=sys.stderr)
            failed.append(e["id"])
    return ok, failed


# ---------- report ----------
SYMBOL = {
    "installed": "[installed]",
    "available": "[available] (install)",
    "marketplace_missing": "[x] marketplace not added",
    "unavailable": "[x] not in marketplace catalog (stale id?)",
    "placeholder": "[ ] placeholder - fill template",
    "no_template": "[ ] no template for this stack",
}


def print_report(stacks: list[str], entries: list[dict]) -> None:
    print("Detected stack:", ", ".join(stacks))
    for e in entries:
        pid = e["id"] or f"(stack: {e['stack']})"
        via = e.get("via", e["stack"])
        leaf_path = STACK_PATHS.get(e["stack"])
        tag = f"[{e['stack']}]" if via == leaf_path or e["state"] == "no_template" else f"[{e['stack']} via {via}]"
        print(f"  {tag} {pid}  {SYMBOL.get(e['state'], e['state'])}")
        c = e.get("commands")
        if not c:
            continue
        if c.get("marketplace_add"):
            for form, val in c["marketplace_add"].items():
                print(f"        marketplace_add.{form}: {val}")
        if c.get("refresh"):
            for form, val in c["refresh"].items():
                print(f"        refresh.{form}: {val}")
        for form, val in c.get("install", {}).items():
            print(f"        install.{form}: {val}")


def print_present(declared: set[str]) -> None:
    present = present_enabled()
    if not present:
        return
    all_declared = set(declared) | {e["id"] for e in known_plugins(set())}
    print("\nAlready enabled in project settings (removable via -i):")
    orphaned = []
    for pid in present:
        if pid in declared:
            tag = "declared by this stack"
        elif pid in all_declared:
            tag = "declared by another stack's template"
        else:
            tag = "ORPHANED - no template declares this (stale?)"
            orphaned.append(pid)
        print(f"  - {pid}  [{tag}]")
    if orphaned:
        print("  Note: ORPHANED plugins are enabled but no current template declares them - likely")
        print("  stale. Uncheck them in the interactive flow (-i) to remove; not auto-removed, since")
        print("  you may have enabled them deliberately.")


def print_skills(skills: list[dict]) -> None:
    if not skills:
        return
    print("\nStack skills (npx skills add - opt-in, not auto-installed; run -i to install):")
    for e in skills:
        mark = "[installed]" if e["state"] == "installed" else "[available]"
        print(f"  - {e['id']}  {mark}")
        if e.get("description"):
            print(f"      {_short(e['description'])}")


# ---------- apply ----------
def apply(enable_ids: list[str], remove_ids: list[str], stacks: list[str]) -> int:
    _, nonplugin = gather(stacks)
    # RISK-SETTINGS-001: load + merge + write under a lock so a concurrent session-init.mjs
    # write to the same settings.json isn't lost, and the file is never left half-written.
    lock = _acquire_lock(SETTINGS)
    try:
        settings = load_json(SETTINGS)  # re-read INSIDE the lock
        ep = settings.get("enabledPlugins")
        if not isinstance(ep, dict):
            ep = {}
        settings["enabledPlugins"] = ep
        deep_merge(settings, nonplugin)  # stack settings (non-plugin keys)
        enabled, removed = [], []
        for pid in enable_ids:
            if pid and not is_placeholder(pid):
                ep[pid] = True
                enabled.append(pid)
        for pid in remove_ids:
            if pid in ep:
                del ep[pid]
                removed.append(pid)
        settings.setdefault("enabledPlugins", {})
        _write_atomic(SETTINGS, json.dumps(settings, indent=2, ensure_ascii=False) + "\n")
    finally:
        _release_lock(lock)
    print("Enabled:", ", ".join(enabled) if enabled else "(none)")
    print("Removed:", ", ".join(removed) if removed else "(none)")
    print(f"Wrote {SETTINGS}")
    print("enabledPlugins resolves at startup - RESTART Claude Code to apply.")
    return 0



# ---------- interactive TUI (stdlib only, cross-platform) ----------
def _enable_vt() -> None:
    if os.name != "nt":
        return
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint()
        if k.GetConsoleMode(h, ctypes.byref(mode)):
            k.SetConsoleMode(h, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
    except Exception:
        pass


def _getch() -> str:
    """Read one keypress; return UP/DOWN/LEFT/RIGHT/ENTER/SPACE/QUIT/OTHER."""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):
            ch2 = msvcrt.getwch()
            return {"H": "UP", "P": "DOWN", "K": "LEFT", "M": "RIGHT"}.get(ch2, "OTHER")
        if ch in ("\r", "\n"):
            return "ENTER"
        if ch == " ":
            return "SPACE"
        if ch in ("q", "Q", "\x1b", "\x03"):
            return "QUIT"
        return "OTHER"
    import termios, tty, select
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        b = os.read(fd, 1)  # raw fd read (avoids Python stdin buffering swallowing escape bytes)
        if b == b"\x1b":
            r, _, _ = select.select([fd], [], [], 0.05)
            if not r:
                return "QUIT"
            seq = os.read(fd, 2)
            return {b"[A": "UP", b"[B": "DOWN", b"[D": "LEFT", b"[C": "RIGHT"}.get(seq, "OTHER")
        if b in (b"\r", b"\n"):
            return "ENTER"
        if b == b" ":
            return "SPACE"
        if b in (b"q", b"Q", b"\x03"):
            return "QUIT"
        return "OTHER"
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def interactive_select(labels, preselected=None, multi=True, hint=None, title=None):
    """Arrow-key menu. multi=True -> returns set of indices (or None if cancelled);
    multi=False -> returns chosen index (or None)."""
    import shutil
    _enable_vt()
    n = len(labels)
    if n == 0:
        return set() if multi else None
    width = max(20, shutil.get_terminal_size((80, 24)).columns - 4)
    sel = set(preselected or [])
    cur = 0
    if hint is None:
        hint = ("up/down move - space toggle - enter confirm - q cancel" if multi
                else "up/down move - enter select - q cancel")

    def body():
        out = []
        for i, lab in enumerate(labels):
            pointer = ">" if i == cur else " "
            box = (("[x]" if i in sel else "[ ]") + " ") if multi else ""
            out.append(("\x1b[2K" + f"{pointer} {box}{lab}")[:width + 8])
        out.append("\x1b[2K(" + hint + ")")
        return out

    if title:
        sys.stdout.write(title + "\n")
    lines = body()
    sys.stdout.write("\x1b[?25l" + "\n".join(lines) + "\n")
    sys.stdout.flush()
    height = len(lines)
    try:
        while True:
            k = _getch()
            if k == "UP":
                cur = (cur - 1) % n
            elif k == "DOWN":
                cur = (cur + 1) % n
            elif k == "SPACE" and multi:
                sel.symmetric_difference_update({cur})
            elif k == "ENTER":
                return set(sel) if multi else cur
            elif k == "QUIT":
                return None
            lines = body()
            sys.stdout.write(f"\x1b[{height}A" + "\n".join(lines) + "\n")
            sys.stdout.flush()
    finally:
        sys.stdout.write("\x1b[?25h")
        sys.stdout.flush()


STATE_MARK = {
    "installed": "[installed]",
    "available": "[needs install]",
    "marketplace_missing": "[needs install + marketplace]",
    "unavailable": "[needs install (stale catalog?)]",
    "placeholder": "[placeholder - can't install]",
}


def _short(desc: str, width: int = 100) -> str:
    """One-line, ASCII-safe description preview (collapses whitespace, truncates with ...)."""
    desc = " ".join((desc or "").split())
    return desc if len(desc) <= width else desc[:width - 3] + "..."


def _run_cmd(cmd: str, capture: bool = False) -> tuple[bool, str]:
    """Run one install/marketplace command. shell=True is safe here: every command string comes
    from our own setting-templates/*.json (trusted, static), never from user input, and shell=True
    is what lets a bare `claude` resolve to claude.cmd on Windows / the PATH entry on POSIX.
    capture=True buffers combined stdout+stderr (printed once the process exits, not streamed
    live) and returns it so callers can pattern-match the failure text; only used for
    marketplace_add, where losing live streaming is an acceptable trade for detecting a known
    retryable failure."""
    print(f"    $ {cmd}")
    try:
        if capture:
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                                   errors="replace")
            out = (proc.stdout or "") + (proc.stderr or "")
            sys.stdout.write(out)
            return proc.returncode == 0, out
        return subprocess.run(cmd, shell=True).returncode == 0, ""
    except Exception as exc:  # launch failure (claude not on PATH, etc.)
        print(f"    ! failed to launch: {exc}", file=sys.stderr)
        return False, str(exc)


# Signature of a known upstream issue: some marketplace repos (e.g. pleaseai/claude-code-plugins)
# pin their OWN submodules to git@github.com: SSH URLs in .gitmodules regardless of how the
# marketplace repo itself was cloned, so `marketplace_add` can fail with an SSH host-key/auth
# error even when its own URL is HTTPS. See setting-templates/README.md for the full writeup.
_SSH_SUBMODULE_FAILURE_MARKERS = (
    "host key is not in your known_hosts file",
    "Host key verification failed",
    "Permission denied (publickey)",
)


def _run_marketplace_add(cmd: str) -> bool:
    """Run a marketplace_add command; on a recognized SSH-submodule failure, retry once with a
    git URL rewrite scoped to just this subprocess call (via GIT_CONFIG_COUNT/KEY/VALUE env vars,
    git >= 2.31) so git@github.com: submodule fetches go over HTTPS instead. This never touches
    the user's actual ~/.gitconfig - it's process-local and reverts the moment the call returns."""
    ok, out = _run_cmd(cmd, capture=True)
    if ok or not any(m in out for m in _SSH_SUBMODULE_FAILURE_MARKERS):
        return ok
    print("    ! marketplace add failed on an SSH host-key/auth error - retrying with a "
          "process-scoped git@github.com: -> https://github.com/ rewrite "
          "(no changes to your global git config)...")
    env = os.environ.copy()
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "url.https://github.com/.insteadOf"
    env["GIT_CONFIG_VALUE_0"] = "git@github.com:"
    print(f"    $ {cmd}")
    try:
        retry_ok = subprocess.run(cmd, shell=True, env=env).returncode == 0
    except Exception as exc:
        print(f"    ! failed to launch: {exc}", file=sys.stderr)
        return False
    if not retry_ok:
        print("    ! retry also failed - if this persists, run on this machine:\n"
              '        git config --global url."https://github.com/".insteadOf "git@github.com:"',
              file=sys.stderr)
    return retry_ok


def install_missing(entries: list[dict]) -> tuple[list[str], list[str]]:
    """Install each not-yet-installed plugin: marketplace add first when its marketplace is
    missing (refresh first when the catalog is stale), then the plugin itself. Returns
    (succeeded_ids, failed_ids). Placeholders / entries with no install command are skipped."""
    ok: list[str] = []
    failed: list[str] = []
    for e in entries:
        pid = e["id"]
        c = e.get("commands") or {}
        install_cmd = (c.get("install", {}) or {}).get("cmd")
        if is_placeholder(pid) or not install_cmd:
            print(f"  - {pid}: no install command available (skipped)")
            failed.append(pid)
            continue
        print(f"  Installing {pid} ...")
        refresh_cmd = (c.get("refresh", {}) or {}).get("cmd")
        if refresh_cmd:                       # state 'unavailable': try to refresh the catalog first
            _run_cmd(refresh_cmd)
        ma_cmd = (c.get("marketplace_add", {}) or {}).get("cmd")
        if ma_cmd and not _run_marketplace_add(ma_cmd):  # state 'marketplace_missing': add first
            print(f"  ! {pid}: marketplace add failed - skipping install", file=sys.stderr)
            failed.append(pid)
            continue
        if _run_cmd(install_cmd)[0]:
            ok.append(pid)
        else:
            print(f"  ! {pid}: install failed", file=sys.stderr)
            failed.append(pid)
    return ok, failed


def _print_plugin_list(title: str, entries: list[dict], present: list[str]) -> None:
    print(title)
    for e in entries:
        mark = "  <-- enabled now" if e["id"] in present else ""
        print(f"  - {e['id']}  {STATE_MARK.get(e['state'], e['state'])}{mark}")
        if e.get("description"):
            print(f"      {_short(e['description'])}")


def run_interactive(stacks: list[str]) -> int:
    stack_entries = [e for e in gather(stacks)[0] if e["id"]]
    for e in stack_entries:
        e["group"] = "stack"
    stack_ids = {e["id"] for e in stack_entries}
    known = known_plugins(stack_ids)          # every other declared plugin, opt-in
    present = present_enabled()
    autoenable = resolved_autoenable(stacks)

    # 1) two informational lists: detected-stack plugins, then other known (optional) plugins.
    print("Detected stack:", ", ".join(stacks))
    _print_plugin_list("\nStack plugins (detected for this project):", stack_entries, present)
    if known:
        _print_plugin_list("\nOther known plugins (optional - pick only if you want them):",
                           known, present)
    known_ids = {e["id"] for e in known}
    foreign = [p for p in present if p not in stack_ids and p not in known_ids]
    if foreign:
        print("\n(also enabled, not declared by any template: " + ", ".join(foreign) + ")")

    # 2) one checklist over everything installable (placeholders can't be installed/enabled).
    #    Pre-checked = already-enabled + the stack's auto-enable set, so the default selection
    #    equals what a plain --apply-all would activate; the user edits from there.
    selectable = [e for e in (stack_entries + known) if e["state"] != "placeholder"]
    # Currently-enabled plugins that NO template declares (orphaned/stale, or user-added): make them
    # selectable and PRE-checked so they are preserved by default and only removed if the user
    # unchecks - never silently dropped just because no template mentions them anymore.
    covered = {e["id"] for e in selectable}
    for pid in present:
        if pid not in covered:
            selectable.append({"id": pid, "state": "installed", "group": "enabled",
                               "description": "(enabled; not declared by any template - orphaned/stale?)"})
    if not selectable:
        print("\nNothing to configure. No changes.")
        return 0
    labels = []
    for e in selectable:
        suffix = "" if e["state"] == "installed" else f"  ({e['state']})"
        labels.append(f"[{e['group']}] {e['id']}{suffix}")
    preselect = {i for i, e in enumerate(selectable)
                 if e["id"] in present or (e["group"] == "stack" and e["id"] in autoenable)}
    sel = interactive_select(
        labels, preselected=preselect, multi=True,
        title="\nCheck plugins to be ACTIVE in this project (missing ones get installed on confirm):")
    if sel is None:
        print("\nCancelled - no changes."); return 0
    chosen = [selectable[i] for i in sorted(sel)]
    chosen_ids = {e["id"] for e in chosen}

    # 3) install the chosen-but-missing, then activate the ones that are (now) installed and
    #    disable any currently-enabled plugin the user unchecked.
    to_install = [e for e in chosen if e["state"] != "installed"]
    installed_now: list[str] = []
    install_failed: list[str] = []
    if to_install:
        print("\nInstalling missing plugins:")
        installed_now, install_failed = install_missing(to_install)

    enable_ids = [e["id"] for e in chosen
                  if e["state"] == "installed" or e["id"] in installed_now]
    remove_ids = [p for p in present if p not in chosen_ids]

    if install_failed:
        print("\n! Failed to install (NOT enabled): " + ", ".join(install_failed))
        print("  Fix/install them by hand, then re-run  python3 ~/.claude/bin/init-stack.py -i")

    if enable_ids or remove_ids:
        apply(enable_ids, remove_ids, stacks)
    else:
        print("\nNo plugin changes to project settings.")
    offer_skills(stacks)
    return 0


def offer_skills(stacks: list[str]) -> None:
    """Interactive skill step: show the stack's declared skills and offer to `npx skills add` the
    MISSING ones. None pre-checked (skills are opt-in). Skills have no enable/disable - install only."""
    skills = gather_skills(stacks)
    if not skills:
        return
    missing = [e for e in skills if e["state"] != "installed"]
    print("\nStack skills:")
    for e in skills:
        print(f"  - {e['id']}  [{'installed' if e['state'] == 'installed' else 'available'}]")
    if not missing:
        return
    labels = [f"{e['id']}" for e in missing]
    sel = interactive_select(labels, preselected=set(), multi=True,
                             title="\nSkills to INSTALL now (npx skills add; none pre-checked):")
    if not sel:
        return
    chosen = [missing[i] for i in sorted(sel)]
    print("\nInstalling skills:")
    ok, failed = install_skills(chosen)
    print("Installed:", ", ".join(ok) if ok else "(none)")
    if failed:
        print("Failed:", ", ".join(failed), "- verify the `npx skills add` slug and retry.")


# ---------- gsd-* agents: context-mode MCP tool sync (best-effort, cross-tool) ----------
def sync_gsd_context_mode_agents() -> None:
    """gsd-* agents (~/.claude/agents/gsd-*.md) belong to the separate gsd-core tool, not this
    bundle, so the actual patch logic lives in Node (hooks/lib/context-mode-gsd-agents.mjs,
    shared with setup.mjs and session-init.mjs). Python has no import path into a .mjs module,
    so this spawns the CLI wrapper instead. Silent no-op if node or the script isn't present -
    never blocks stack detection/setup on it."""
    script = HOME / ".claude" / "sync-gsd-context-mode-tool.mjs"
    if not script.exists():
        return
    try:
        r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=10)
        out = (r.stdout or "").strip()
        if out:
            print(out)
    except Exception:
        pass


# ---------- main ----------
def main() -> int:
    _force_utf8_stdio()
    sync_gsd_context_mode_agents()
    args = sys.argv[1:]

    if args and args[0] == "--status":
        if len(args) < 2:
            print('{"error":"--status needs a plugin id"}')
            return 2
        pid = args[1]
        state = classify(pid, installed_ids(), known_marketplaces())
        print(json.dumps({"id": pid, "state": state}, ensure_ascii=False))
        return 0

    stacks = detect()
    if not stacks:
        print("No known stack detected in", ROOT)
        return 0

    if args and args[0] == "--apply-all":
        entries, _ = gather(stacks)
        ids = [e["id"] for e in entries
               if e["id"] and e["state"] != "placeholder"]
        return apply(ids, [], stacks)

    if "-i" in args or "--interactive" in args:
        if sys.stdin.isatty() and sys.stdout.isatty():
            return run_interactive(stacks)
        print("Interactive mode needs a real terminal (TTY). Run it directly:\n"
              "  python3 ~/.claude/bin/init-stack.py -i", file=sys.stderr)
        # fall through to the text report below

    if "--enable" in args or "--remove" in args:
        return apply(grab(args, "--enable"), grab(args, "--remove"), stacks)

    # default: report only
    entries, _ = gather(stacks)
    declared = {e["id"] for e in entries if e["id"]}
    present = present_enabled()
    skills = gather_skills(stacks)
    print_report(stacks, entries)
    print_present(declared)
    print_skills(skills)
    print("\n=== STATUS_JSON ===")
    payload = {
        "stacks": stacks,
        "plugins": entries,
        "present": [{"id": pid, "declared": pid in declared} for pid in present],
        "skills": skills,
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
