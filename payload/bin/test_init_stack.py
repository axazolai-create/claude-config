#!/usr/bin/env python3
"""Stdlib-only tests for bin/init-stack.py's template resolver (STACK_PATHS, _resolve_chain,
gather). Run: python3 bin/test_init_stack.py -v"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parent

_spec = importlib.util.spec_from_file_location("init_stack", THIS_DIR / "init-stack.py")
init_stack = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(init_stack)


class RealTemplatesTests(unittest.TestCase):
    """Exercise the resolver against the actual setting-templates/ tree shipped in this repo."""

    @classmethod
    def setUpClass(cls):
        cls._orig_templates_dir = init_stack.TEMPLATES_DIR
        init_stack.TEMPLATES_DIR = REPO_ROOT / "setting-templates"

    @classmethod
    def tearDownClass(cls):
        init_stack.TEMPLATES_DIR = cls._orig_templates_dir

    def test_react_inherits_frontend_plugins(self):
        entries, _ = init_stack.gather(["react"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("typescript-lsp@claude-plugins-official", ids)
        self.assertIn("frontend-design@claude-plugins-official", ids)
        self.assertIn("playwright@claude-plugins-official", ids)
        self.assertIn("accesslint@accesslint", ids)

    def test_react_native_inherits_both_frontend_and_mobile(self):
        entries, _ = init_stack.gather(["react-native"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("typescript-lsp@claude-plugins-official", ids)  # frontend, vertical parent
        self.assertIn("expo@claude-plugins-official", ids)            # its own plugin
        self.assertIn("auth0@claude-plugins-official", ids)           # mobile, explicit extends

    def test_telegram_node_inherits_bots_vertical_and_backend_node_explicit(self):
        entries, _ = init_stack.gather(["telegram-node"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("typescript-lsp@claude-plugins-official", ids)  # backend/node, explicit extends

    def test_kotlin_is_standalone(self):
        entries, _ = init_stack.gather(["kotlin"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("kotlin-lsp@claude-plugins-official", ids)      # its own plugin
        self.assertIn("context7@claude-plugins-official", ids)        # root _base universal, inherited by all
        # standalone == no cross-branch (frontend/backend/mobile) plugin leaks in
        self.assertNotIn("typescript-lsp@claude-plugins-official", ids)
        self.assertNotIn("expo@claude-plugins-official", ids)

    def test_aspnet_inherits_backend_csharp_base(self):
        entries, _ = init_stack.gather(["aspnet"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)  # backend/csharp/_base.json, vertical parent
        self.assertIn("context7@claude-plugins-official", ids)    # root _base universal

    def test_csharp_bare_stack_reuses_backend_csharp_base(self):
        entries, _ = init_stack.gather(["csharp"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)
        self.assertIn("context7@claude-plugins-official", ids)

    def test_csharp_cli_is_standalone(self):
        entries, _ = init_stack.gather(["csharp-cli"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)  # its own plugin
        self.assertIn("context7@claude-plugins-official", ids)    # root _base universal
        self.assertNotIn("typescript-lsp@claude-plugins-official", ids)
        self.assertNotIn("kotlin-lsp@claude-plugins-official", ids)

    def test_wpf_is_standalone(self):
        entries, _ = init_stack.gather(["wpf"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("csharp-lsp@claude-plugins-official", ids)
        self.assertIn("context7@claude-plugins-official", ids)
        self.assertNotIn("typescript-lsp@claude-plugins-official", ids)

    def test_python_bare_stack_reuses_backend_python_base(self):
        entries, _ = init_stack.gather(["python"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("pyright-lsp@claude-plugins-official", ids)     # backend/python/_base.json, as leaf
        self.assertIn("context7@claude-plugins-official", ids)        # root _base universal

    def test_node_bare_stack_reuses_backend_node_base(self):
        entries, _ = init_stack.gather(["node"])
        ids = {e["id"] for e in entries if e["id"]}
        self.assertIn("typescript-lsp@claude-plugins-official", ids)  # backend/node/_base.json, as leaf
        self.assertIn("context7@claude-plugins-official", ids)        # root _base universal

    def test_no_template_for_unknown_stack(self):
        entries, _ = init_stack.gather(["not-a-real-stack"])
        self.assertEqual(entries[0]["state"], "no_template")

    def test_gather_skills_per_stack(self):
        self.assertEqual({s["id"] for s in init_stack.gather_skills(["android"])},
                         {"chrisbanes/skills", "skydoves/compose-performance-skills"})
        self.assertEqual({s["id"] for s in init_stack.gather_skills(["react"])}, {"shadcn"})
        self.assertEqual({s["id"] for s in init_stack.gather_skills(["sql"])}, {"planetscale/database-skills"})
        self.assertEqual({s["name"] for s in init_stack.gather_skills(["django"])}, {"django-expert"})
        self.assertEqual(init_stack.gather_skills(["nx"]), [])  # a stack declaring no skills

    def test_every_stack_path_resolves_to_a_real_file(self):
        for stack, rel_path in init_stack.STACK_PATHS.items():
            with self.subTest(stack=stack):
                self.assertTrue((init_stack.TEMPLATES_DIR / rel_path).exists(),
                                f"{stack} -> {rel_path} does not exist")


class SyntheticFixtureTests(unittest.TestCase):
    """Exercise vertical inheritance, explicit extends, `pick`, and cycle-safety against a
    throwaway template tree, independent of this repo's real content."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        orig = init_stack.TEMPLATES_DIR
        init_stack.TEMPLATES_DIR = self.root
        self.addCleanup(lambda: setattr(init_stack, "TEMPLATES_DIR", orig))

    def _write(self, rel_path, data):
        p = self.root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding="utf-8")

    def test_vertical_inheritance_root_and_dir_base(self):
        self._write("_base.json", {"stack": "_root", "merge": {"enabledPlugins": {"root-p": True}}, "plugins": []})
        self._write("dir/_base.json", {"stack": "_dir", "merge": {"enabledPlugins": {"dir-p": True}}, "plugins": []})
        self._write("dir/leaf.json", {"stack": "leaf", "merge": {}, "plugins": []})
        chain = init_stack._resolve_chain("dir/leaf.json")
        labels = [label for label, _ in chain]
        self.assertEqual(labels, ["_base.json", "dir/_base.json", "dir/leaf.json"])

    def test_explicit_extends_cross_branch(self):
        self._write("a/_base.json", {"stack": "a", "merge": {}, "plugins": [{"id": "a-p"}]})
        self._write("b/_base.json", {"stack": "b", "merge": {}, "plugins": [{"id": "b-p"}]})
        self._write("a/leaf.json", {"stack": "leaf", "extends": ["b/_base.json"], "merge": {}, "plugins": []})
        chain = init_stack._resolve_chain("a/leaf.json")
        labels = [label for label, _ in chain]
        self.assertEqual(labels, ["a/_base.json", "b/_base.json", "a/leaf.json"])

    def test_pick_restricts_to_named_top_level_keys(self):
        self._write("a/_base.json", {"stack": "a", "merge": {}, "plugins": []})
        self._write("b/_base.json", {"stack": "b", "merge": {"enabledPlugins": {"b-merge": True}},
                                      "plugins": [{"id": "b-plugin"}], "_notes": ["should be dropped"]})
        self._write("a/leaf.json", {"stack": "leaf", "extends": ["b/_base.json"],
                                     "pick": {"b/_base.json": ["plugins"]}, "merge": {}, "plugins": []})
        chain = init_stack._resolve_chain("a/leaf.json")
        picked = dict(chain)["b/_base.json"]
        self.assertNotIn("merge", picked)
        self.assertNotIn("_notes", picked)
        self.assertEqual(picked["plugins"], [{"id": "b-plugin"}])

    def test_pick_restricts_every_tuple_in_a_multi_level_sub_chain(self):
        self._write("b/_base.json", {"stack": "b-dir", "merge": {"enabledPlugins": {"b-dir-p": True}},
                                      "plugins": [{"id": "b-dir-plugin"}]})
        self._write("b/leaf.json", {"stack": "b", "merge": {"enabledPlugins": {"b-merge": True}},
                                     "plugins": [{"id": "b-plugin"}], "_notes": ["should be dropped"]})
        self._write("a/leaf.json", {"stack": "leaf", "extends": ["b/leaf.json"],
                                     "pick": {"b/leaf.json": ["plugins"]}, "merge": {}, "plugins": []})
        chain = init_stack._resolve_chain("a/leaf.json")
        by_label = dict(chain)
        # b/leaf.json's own vertical ancestor (b/_base.json) is part of its resolved sub-chain too -
        # pick must filter EVERY tuple in that sub-chain, not just b/leaf.json's own tuple.
        self.assertNotIn("merge", by_label["b/_base.json"])
        self.assertEqual(by_label["b/_base.json"]["plugins"], [{"id": "b-dir-plugin"}])
        self.assertNotIn("merge", by_label["b/leaf.json"])
        self.assertEqual(by_label["b/leaf.json"]["plugins"], [{"id": "b-plugin"}])

    def test_cycle_is_safe(self):
        self._write("a.json", {"stack": "a", "extends": ["b.json"], "merge": {}, "plugins": []})
        self._write("b.json", {"stack": "b", "extends": ["a.json"], "merge": {}, "plugins": []})
        chain = init_stack._resolve_chain("a.json")  # must terminate, not recurse forever
        labels = [label for label, _ in chain]
        self.assertIn("a.json", labels)


if __name__ == "__main__":
    unittest.main()
