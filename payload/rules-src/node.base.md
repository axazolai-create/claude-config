---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs}"
  - "**/package.json"
  - "**/tsconfig*.json"
---

# Node / TypeScript (base)
- Runtime: Node 24 LTS (Active LTS; Node 22 is Maintenance-only as of late 2025).
  Package manager: pnpm (not npm/yarn unless the repo says so).
- TypeScript strict mode on. No `any` in public signatures; prefer `unknown` + narrowing.
- ESM only (`"type": "module"`). Use `import`, not `require`.
- Lint/format: ESLint + Prettier. Run `pnpm lint && pnpm test` before commit.
- Errors: throw `Error` subclasses, never strings. No silent catches.
- Async: `async/await`, not raw `.then` chains. Always handle rejections.
- Validate at boundaries (zod or equivalent) — never trust external input.
- Avoid: default exports for shared modules, barrel files that hide cycles,
  scattered `process.env` reads (centralize config).
