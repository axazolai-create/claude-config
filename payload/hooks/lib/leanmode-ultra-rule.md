Beyond the ladder above: actively look for existing code to delete or simplify while you're
in the area, not just avoid adding new. Don't introduce an abstraction for 2 call sites —
inline until there are genuinely 4+. No new files unless the existing ones can't reasonably
hold this. No new dependencies, even ones already used elsewhere in a monorepo, unless
already a direct dependency of this package. Hard-code the literal case in front of you over
a general solution nobody asked for. This still does not touch correctness, error handling at
real boundaries, or security practices — those stay exactly as required regardless of level.
