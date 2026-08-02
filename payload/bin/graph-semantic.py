"""Semantic search over the cross-project symbol corpus.

  python graph-semantic.py --build            embed the corpus, write vectors beside the graph
  python graph-semantic.py --query "<text>"   nearest symbols, JSON on stdout

Vectors live in ~/.graphify/. Everything is read and written as UTF-8 explicitly: the corpus
carries Russian comments and the Windows console default mangles them.
"""
import argparse, json, os, pathlib, sys, time

HOME = pathlib.Path(os.path.expanduser("~")) / ".graphify"
DOCS = HOME / "global-docs.md"
INDEX = HOME / "global-index.tsv"
VECS = HOME / "semantic-vectors.npy"
META = HOME / "semantic-meta.json"
MODEL = "BAAI/bge-small-en-v1.5"

GENERATED = (".vite-inspect/", "/dist/", "/build/", "/out/", "/coverage/",
             "/node_modules/", "/vendor/", "/_vendored/", "/assets/", ".build-final/", ".min.js")


def is_generated(path: str) -> bool:
    p = "/" + path.replace("\\", "/")
    return any(m in p for m in GENERATED)


def corpus():
    """One row per symbol: the comment when there is one, else name + location."""
    rows, seen = [], set()
    if DOCS.exists():
        for chunk in DOCS.read_text(encoding="utf-8").split("\n## "):
            lines = [l for l in chunk.strip().split("\n") if l.strip()]
            if len(lines) < 3:
                continue
            head = lines[0].replace("## ", "")
            repo = lines[1].replace("repo: ", "").strip()
            body = " ".join(lines[2:]).strip()
            file = head.split(" — ")[-1] if " — " in head else ""
            if is_generated(file):
                continue
            key = head
            if key in seen:
                continue
            seen.add(key)
            rows.append({"label": head.split(" — ")[0], "where": file, "repo": repo,
                         "text": f"{head.split(' — ')[0]}. {body}"})
    if INDEX.exists():
        for line in INDEX.read_text(encoding="utf-8").split("\n"):
            p = line.split("\t")
            if len(p) < 3 or not p[0] or is_generated(p[2]):
                continue
            key = f"{p[0]} — {p[2]}:{p[3] if len(p) > 3 else ''}"
            if key in seen:
                continue
            seen.add(key)
            rows.append({"label": p[0], "where": f"{p[2]}:{p[3] if len(p) > 3 else ''}",
                         "repo": p[1], "text": f"{p[0]} in {p[2]} ({p[1]})"})
    return rows


def build():
    import numpy as np
    from fastembed import TextEmbedding
    rows = corpus()
    if not rows:
        print("nothing to embed - run graph-docs.mjs --build and graph-find.mjs --build first")
        return 1
    t = time.time()
    model = TextEmbedding(model_name=MODEL)
    vecs = np.array(list(model.embed([r["text"] for r in rows])), dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
    np.save(VECS, vecs)
    META.write_text(json.dumps([{k: r[k] for k in ("label", "where", "repo")} for r in rows],
                               ensure_ascii=False), encoding="utf-8")
    print(f"embedded {len(rows)} symbols in {time.time()-t:.0f} s -> {VECS} ({vecs.nbytes/1e6:.0f} MB)")
    return 0


def query(text, k):
    import numpy as np
    from fastembed import TextEmbedding
    if not VECS.exists():
        print(json.dumps({"error": "no vectors - run --build first"}, ensure_ascii=False))
        return 1
    vecs = np.load(VECS)
    meta = json.loads(META.read_text(encoding="utf-8"))
    model = TextEmbedding(model_name=MODEL)
    q = np.array(list(model.embed([text]))[0], dtype=np.float32)
    q /= np.linalg.norm(q) + 1e-9
    sims = vecs @ q
    out = []
    for i in np.argsort(-sims)[:k]:
        m = meta[int(i)]
        out.append({"score": round(float(sims[i]), 3), **m})
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--query")
    ap.add_argument("--limit", type=int, default=8)
    a = ap.parse_args()
    raise SystemExit(build() if a.build else query(a.query, a.limit) if a.query else ap.print_help())
