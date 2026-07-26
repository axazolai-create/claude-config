import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STACK_PATHS, detect, detectStacks } from "./stack-markers.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
function tmp(files) {
  const d = mkdtempSync(join(tmpdir(), "sm-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(d, ...rel.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return d;
}

test("react-native wins over react (RN pulls react in)", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { react: "18", "react-native": "0.74" } }) });
  const s = detect(d);
  assert.ok(s.includes("react-native") && !s.includes("react"), s.join(","));
});

test("plain react (no RN/expo signals) is tagged react, not node", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { react: "18" } }) });
  const s = detect(d);
  assert.deepEqual(s, ["react"]);
});

test("bare node fallback fires only when no framework matched", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { lodash: "4" } }) });
  const s = detect(d);
  assert.deepEqual(s, ["node"]);
});

test("bare node fallback is suppressed when a framework matched", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { next: "14" } }) });
  const s = detect(d);
  assert.ok(s.includes("next") && !s.includes("node"), s.join(","));
});

test("bare python fallback fires only when no framework/bot-lib matched", () => {
  const d = tmp({ "pyproject.toml": "[project]\nname = 'x'\ndependencies = ['requests']" });
  const s = detect(d);
  assert.deepEqual(s, ["python"]);
});

test("bare python fallback is suppressed when a framework matched", () => {
  const d = tmp({ "pyproject.toml": "[project]\ndependencies = ['fastapi']" });
  const s = detect(d);
  assert.ok(s.includes("fastapi") && !s.includes("python"), s.join(","));
});

test("requirements*.txt contributes to python text detection", () => {
  const d = tmp({ "requirements-dev.txt": "Flask==3.0\n" });
  const s = detect(d);
  assert.deepEqual(s, ["flask"]);
});

test("android is gated on AndroidManifest.xml, not bare kotlin files", () => {
  const d = tmp({ "app/build.gradle.kts": "" });
  const s = detect(d);
  assert.ok(s.includes("kotlin") && !s.includes("android"), s.join(","));
});

test("android detected when AndroidManifest.xml present alongside kotlin", () => {
  const d = tmp({ "app/build.gradle.kts": "", "app/src/main/AndroidManifest.xml": "<manifest/>" });
  const s = detect(d);
  assert.ok(s.includes("kotlin") && s.includes("android"), s.join(","));
});

test("dart checked before swift: Flutter's vendored ios/ project does not false-positive as swift", () => {
  const d = tmp({
    "pubspec.yaml": "name: app",
    "ios/Runner.xcodeproj/project.pbxproj": "",
  });
  const s = detect(d);
  assert.ok(s.includes("dart") && !s.includes("swift"), s.join(","));
});

test("react-native checked before swift: RN's vendored ios/ project does not false-positive as swift", () => {
  const d = tmp({
    "package.json": JSON.stringify({ dependencies: { "react-native": "0.74" } }),
    "ios/Runner.xcodeproj/project.pbxproj": "",
  });
  const s = detect(d);
  assert.ok(s.includes("react-native") && !s.includes("swift"), s.join(","));
});

test("swift detected standalone via Package.swift when no dart/RN present", () => {
  const d = tmp({ "Package.swift": "// swift-tools-version:5.9" });
  const s = detect(d);
  assert.deepEqual(s, ["swift"]);
});

test("swift detected via *.xcodeproj directory when no dart/RN present", () => {
  const d = tmp({ "MyApp.xcodeproj/project.pbxproj": "" });
  const s = detect(d);
  assert.deepEqual(s, ["swift"]);
});

test("csharp subtypes are mutually exclusive: WPF from <UseWPF>", () => {
  const d = tmp({ "App.csproj": "<Project><PropertyGroup><UseWPF>true</UseWPF></PropertyGroup></Project>" });
  const s = detect(d);
  assert.ok(s.includes("wpf") && !s.includes("aspnet") && !s.includes("csharp-cli"), s.join(","));
});

test("csharp-cli only fires when outputtype=exe and neither aspnet nor wpf matched", () => {
  const d = tmp({ "App.csproj": "<Project><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>" });
  const s = detect(d);
  assert.deepEqual(s, ["csharp-cli"]);
});

test("bare csharp fires only when no more specific csproj signal matched", () => {
  const d = tmp({ "App.csproj": "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>" });
  const s = detect(d);
  assert.deepEqual(s, ["csharp"]);
});

test("aspnet detected from Sdk=\"Microsoft.NET.Sdk.Web\"", () => {
  const d = tmp({ "App.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' });
  const s = detect(d);
  assert.deepEqual(s, ["aspnet"]);
});

test("standalone *.xaml with no .csproj files yields wpf via the fallback branch", () => {
  const d = tmp({ "MainWindow.xaml": "<Window/>" });
  const s = detect(d);
  assert.deepEqual(s, ["wpf"]);
});

test("standalone *.cs with no .csproj/.xaml files yields bare csharp via the fallback branch", () => {
  const d = tmp({ "Program.cs": "class Program {}" });
  const s = detect(d);
  assert.deepEqual(s, ["csharp"]);
});

test("PRUNE excludes node_modules/.git/etc from marker walks", () => {
  const d = tmp({ "node_modules/pkg/Foo.kt": "", ".git/hooks/pre-commit.kts": "" });
  const s = detect(d);
  assert.deepEqual(s, []);
});

test("kitchen sink: multi-stack repo returns ids in insertion order, deduped", () => {
  const d = tmp({
    "package.json": JSON.stringify({ dependencies: { next: "14" } }),
    "pyproject.toml": "[project]\ndependencies = ['fastapi']",
    "turbo.json": "{}",
    "schema.sql": "select 1;",
  });
  const s = detect(d);
  assert.deepEqual(s, ["next", "fastapi", "turbo", "sql"]);
});

test("detectStacks({root}) wraps detect(root)", () => {
  const d = tmp({ "package.json": JSON.stringify({ dependencies: { next: "14" } }) });
  assert.deepEqual(detectStacks({ root: d }), detect(d));
});

test("every STACK_PATHS value resolves to a real shipped template", () => {
  const tplDir = join(ROOT, "..", "..", "setting-templates");
  assert.ok(existsSync(tplDir), `setting-templates dir not found at ${tplDir}`);
  for (const rel of Object.values(STACK_PATHS))
    assert.ok(existsSync(join(tplDir, ...rel.split("/"))), `missing template: ${rel}`);
});

test("STACK_PATHS has exactly 22 entries", () => {
  assert.equal(Object.keys(STACK_PATHS).length, 22);
});
