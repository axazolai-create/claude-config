// graphify -> Neo4j read cookbook. The global graph is pushed by graphify-neo4j-push.mjs.
// Query by `label` and `repo`, NOT by node id: graphify re-keys ids across rebuilds
// (0.9.0 full-path id change), so ids are not stable across pushes.

// 1. God nodes (highest-degree hubs) across all repos
MATCH (n)
RETURN n.label AS label, n.repo AS repo, count { (n)--() } AS degree
ORDER BY degree DESC
LIMIT 20;

// 2. Neighbors of a concept (parametrize $label)
MATCH (n {label: $label})--(m)
RETURN DISTINCT m.label AS label, m.repo AS repo, m.source_file AS file
LIMIT 50;

// 3. Shortest path between two concepts (cross-repo bridges surface here)
MATCH (a {label: $from}), (b {label: $to}),
      p = shortestPath((a)-[*..8]-(b))
RETURN [x IN nodes(p) | x.label + ' (' + coalesce(x.repo,'?') + ')'] AS hops;

// 4. Which repos does a shared external library connect?
MATCH (lib {label: $lib})--(m)
RETURN DISTINCT m.repo AS repo
ORDER BY repo;

// 5. Everything in one repo (sanity / staleness check)
MATCH (n {repo: $repo})
RETURN count(n) AS nodes;
