---
paths:
  - "**/app.py"
  - "**/wsgi.py"
  - "**/blueprints/**/*.py"
  - "**/views/**/*.py"
---

# Flask (direction)
- App-factory pattern + blueprints; no global app object with logic attached.
- Validate input explicitly (pydantic/marshmallow); don't trust `request` directly.
- Config via object/env; never hardcode secrets.
- Keep routes thin; push logic into modules/services.
- Production: behind a real WSGI server (gunicorn/uwsgi) + nginx. Never run the dev server in prod.
- Avoid: business logic in route functions, circular imports between blueprints and app.
