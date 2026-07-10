1. Does this need to be built at all?
2. Does it already exist in this codebase — reuse it, don't rewrite it.
3. Does stdlib/the language runtime already do it?
4. Is there an already-installed dependency that does it?
5. Otherwise: the minimum code that satisfies the actual requirement.
No speculative flexibility, no unrequested abstractions, no config knobs nobody asked for.
This is about complexity, not correctness: error handling at real boundaries, validation,
and security practices stay in place regardless of level.
