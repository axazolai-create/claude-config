---
paths:
  - "**/next.config.*"
  - "**/app/**/{page,layout,route,loading,error}.{ts,tsx}"
  - "**/pages/**/*.{ts,tsx}"
  - "**/middleware.ts"
  - "**/proxy.ts"
---

@AGENTS.md
<!-- Marker for the stack-rules compiler: rewritten to `@../AGENTS.md` in the snapshot so it
     imports the project's root AGENTS.md. See rules-src/README.md ("templates/" section). -->

# Next.js (direction)
- Target Next.js 16+. Turbopack is stable and the default bundler.
- App Router by default. Server Components are the default; add `'use client'` only when
  you need state/effects/browser APIs, and keep client components leaf-level.
- Caching is explicit via Cache Components: wrap cacheable pages/components/functions in
  `'use cache'`; everything else runs dynamically per request by default. Use stable
  `cacheLife`/`cacheTag` (no `unstable_` prefix) for revalidation/invalidation.
- Request interception is `proxy.ts` (Node.js runtime — fs/crypto/npm packages available),
  not `middleware.ts` (Edge runtime; deprecated, still works). Migrate by renaming the file
  and renaming the exported `middleware` function to `proxy`.
- Mutations via Server Actions or route handlers; validate input server-side.
- Never leak secrets to the client — only `NEXT_PUBLIC_*` reaches the browser.
- Use `next/image`, `next/font`, and route-level metadata. `params`/`searchParams` are
  async — `await` them.
- `next lint` and AMP support are removed; lint with ESLint directly.
- React Compiler is stable but opt-in (not on by default) — enable it deliberately.
- React rules (`node.react.md`) also apply.
- Avoid: oversized client bundles from over-using `'use client'`, fetching in `useEffect`
  where a Server Component would do, secrets in client code, new `middleware.ts` files.
