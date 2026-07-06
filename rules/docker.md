---
paths:
  - "**/Dockerfile*"
  - "**/docker-compose*.yml"
  - "**/docker-compose*.yaml"
  - "**/.dockerignore"
---

# Docker (cross-cutting)
- Multi-stage builds: install/build in one stage, copy only the runtime artifact into a
  slim final stage (`-slim`/`-alpine` or distroless where the runtime allows it).
- Pin base images by tag+digest (`node:24-slim@sha256:...`), never `latest`.
- Run as a non-root user in the final stage; drop capabilities you don't need.
- Order layers by change frequency: install deps before copying source, so dependency
  layers stay cached across source-only changes.
- `.dockerignore` excludes `node_modules`, `.git`, `venv`/`.venv`, build artifacts, `.env`.
- No secrets baked into image layers — use build secrets (`--secret`) or runtime env, never
  `ARG`/`ENV` for credentials (they persist in image history).
- Add a `HEALTHCHECK` (or compose healthcheck) for anything behind an orchestrator.
- docker-compose: pin image versions, named volumes for persistent data, explicit networks
  over the default bridge for multi-service setups.
- Avoid: `latest` tags in anything deployed, running as root, secrets in `ENV`/build args,
  copying the whole repo before installing deps (kills layer caching).
