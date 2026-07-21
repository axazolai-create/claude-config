#!/usr/bin/env python3
"""Per-repo staleness hygiene: DETACH DELETE all nodes for the given repo tags.

Multi-PC-safe by construction: only repos passed as argv (the tags present in THIS
machine's global graph) are touched, so other machines' repos in the shared Neo4j are
never deleted. Idempotent - deleting a repo with no nodes is a no-op.

Reads NEO4J_URI / NEO4J_USER (default 'neo4j') / NEO4J_PASSWORD from the environment.
Requires the neo4j driver (already a prerequisite for `graphify export neo4j --push`):
    pip install neo4j
"""
import os
import sys


def main(tags):
    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not uri or not password:
        print("prune: NEO4J_URI/NEO4J_PASSWORD not set in env", file=sys.stderr)
        return 2
    if not tags:
        print("prune: no repo tags given - nothing to delete")
        return 0
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("prune: neo4j driver missing - run: pip install neo4j", file=sys.stderr)
        return 3
    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            for tag in tags:
                count = session.run(
                    "MATCH (n {repo: $tag}) RETURN count(n) AS c", tag=tag
                ).single()["c"]
                session.run("MATCH (n {repo: $tag}) DETACH DELETE n", tag=tag)
                print(f"prune: {tag!r} - {count} node(s) cleared")
    finally:
        driver.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
