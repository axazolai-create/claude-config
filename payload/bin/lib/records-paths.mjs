import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveRecordPaths(root) {
  const tree = join(root, ".ultrapowers");
  const base = existsSync(tree) ? tree : root;
  return {
    base,
    risks: join(base, "RISK_REGISTER.md"),
    adrDir: join(base, "adr"),
    glossary: join(base, "GLOSSARY.md"),
  };
}
