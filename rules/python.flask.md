---
paths:
  - "**/app.py"
  - "**/wsgi.py"
  - "**/blueprints/**/*.py"
  - "**/views/**/*.py"
---

# Flask (direction)
> Weak path-scoping — import per project if it doesn't trigger:
> `@~/.claude/rules/python.flask.md`
- App-factory pattern + blueprints; no global app object with logic attached.
- Validate input explicitly (pydantic/marshmallow); don't trust `request` directly.
- Config via object/env; never hardcode secrets.
- Keep routes thin; push logic into modules/services.
- Production: behind a real WSGI server (gunicorn/uwsgi) + nginx — relevant for the
  publishing box (Server B). Never run the dev server in prod.
- Avoid: business logic in route functions, circular imports between blueprints and app.
