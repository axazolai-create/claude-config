#!/usr/bin/env python3
"""
init-stack: detect this project's stack, classify each stack plugin's state, and
(optionally) merge the matching settings from ~/.claude/setting-templates/<stack>.json
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
  --enable <id...>     enable exactly the given ids in project settings (+ non-plugin keys). Writes.
  --remove <id...>     delete the given ids from project enabledPlugins. Writes.
                       (--enable and --remove may be combined in one call.)
  --apply-all          enable every non-placeholder declared plugin (no removals). Writes.

enabledPlugins is resolved at Claude Code STARTUP; restart after --apply.
"""
from __future__ import annotations
import fnmatch
import json
import os
import sys
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
         "__pycache__", ".next", "target", ".gradle", ".idea"}


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
        else:
            dst[k] = v
    return dst


# ---------- detector-id -> template path (paths no longer mirror the id 1:1 - see
# setting-templates/README.md) ----------
STACK_PATHS: dict[str, str] = {
    "react": "frontend/react.json",
    "next": "frontend/next.json",
    "react-native": "frontend/react-native.json",
    "nest": "backend/node/nest.json",
    "django": "backend/python/django.json",
    "fastapi": "backend/python/fastapi.json",
    "flask": "backend/python/flask.json",
    "android": "mobile/android.json",
    "swift": "mobile/swift.json",
    "dart": "mobile/dart.json",
    "kotlin": "kotlin.json",
    "sql": "sql.json",
    "turbo": "monorepo/turbo.json",
    "nx": "monorepo/nx.json",
    "telegram-node": "bots/node.json",
    "telegram-python": "bots/python.json",
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
                    "commands": commands_for(state, pid, p.get("install", {}) or {}),
                })
    return entries, nonplugin


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
        tag = f"[{e['stack']}]" if via == leaf_path else f"[{e['stack']} via {via}]"
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
    print("\nAlready enabled in project settings (removable):")
    for pid in present:
        tag = "declared by template" if pid in declared else "foreign (not in templates)"
        print(f"  - {pid}  [{tag}]")


# ---------- apply ----------
def apply(enable_ids: list[str], remove_ids: list[str], stacks: list[str]) -> int:
    _, nonplugin = gather(stacks)
    settings = load_json(SETTINGS)
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
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
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


def run_interactive(stacks: list[str]) -> int:
    entries, _ = gather(stacks)
    present = present_enabled()
    declared = {e["id"] for e in entries if e["id"]}

    # 1) plain list with an [enabled] mark
    print("Detected stack:", ", ".join(stacks))
    print("\nPlugins:")
    for e in entries:
        pid = e["id"] or f"(stack: {e['stack']})"
        mark = "  [enabled]" if e["id"] in present else ""
        print(f"  - {pid}  {SYMBOL.get(e['state'], e['state'])}{mark}")
    foreign = [p for p in present if p not in declared]
    if foreign:
        print("  (also enabled, not declared by templates: " + ", ".join(foreign) + ")")
    print()

    # 2) top menu: remove-first or activate directly
    action = interactive_select(
        ["Choose what to ENABLE",
         "REMOVE enabled plugins, then choose what to enable",
         "Quit (no changes)"],
        multi=False, title="What do you want to do?")
    if action is None or action == 2:
        print("\nNo changes."); return 0

    remove_ids: list[str] = []
    if action == 1:
        removable = list(present)
        if removable:
            sel = interactive_select(removable, preselected=set(), multi=True,
                                     title="\nMark plugins to REMOVE:")
            if sel is None:
                print("\nCancelled."); return 0
            remove_ids = [removable[i] for i in sorted(sel)]
        else:
            print("\nNothing is enabled to remove.")

    # 3) activation: installed plugins can be enabled now (checked = active)
    enableable = [e["id"] for e in entries
                  if e["id"] and e["state"] == "installed" and e["id"] not in remove_ids]
    enable_ids: list[str] = []
    if enableable:
        pre = {i for i, c in enumerate(enableable) if c in present}
        sel = interactive_select(enableable, preselected=pre, multi=True,
                                 title="\nSelect plugins to be ACTIVE (checked = enabled):")
        if sel is None:
            print("\nCancelled."); return 0
        enable_ids = [enableable[i] for i in sorted(sel)]
        # currently-enabled but unchecked here -> disable as well
        for c in enableable:
            if c in present and c not in enable_ids and c not in remove_ids:
                remove_ids.append(c)
    else:
        print("\n(no installed plugins to enable; install pending ones first - see states above)")

    if not enable_ids and not remove_ids:
        print("\nNo changes selected."); return 0
    return apply(enable_ids, remove_ids, stacks)


# ---------- main ----------
def main() -> int:
    _force_utf8_stdio()
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
    print_report(stacks, entries)
    print_present(declared)
    print("\n=== STATUS_JSON ===")
    payload = {
        "stacks": stacks,
        "plugins": entries,
        "present": [{"id": pid, "declared": pid in declared} for pid in present],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
