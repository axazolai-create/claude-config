---
paths:
  - "**/manage.py"
  - "**/settings.py"
  - "**/{models,views,urls,admin,apps,forms,serializers}.py"
  - "**/migrations/**/*.py"
  - "**/{asgi,wsgi}.py"
---

# Django (direction)
- Fat models / thin views, or a service layer for complex flows — never logic in templates.
- Migrations are explicit, reviewed, and committed; never edit applied migrations.
- Query discipline: `select_related`/`prefetch_related` to kill N+1; no queries in loops.
- Settings split by environment; secrets from env, never in `settings.py`.
- DRF: serializers validate input; viewsets stay thin; permissions explicit.
- Use the ORM; raw SQL only when justified and parameterized.
- Avoid: N+1 queries, signals for core business logic, logic in templates.
