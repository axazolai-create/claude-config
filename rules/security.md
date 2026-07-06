---
paths:
  - "**/*auth*/**"
  - "**/*.env*"
  - "**/*secret*"
  - "**/*jwt*"
  - "**/*session*"
  - "**/*crypto*"
---

# Security (cross-cutting, auth/secrets surface)
- Passwords: hash with bcrypt/argon2id (work factor tuned for ~200ms+); never MD5/SHA1/
  plain, never roll your own scheme.
- Tokens: short-lived access tokens + rotating refresh tokens; verify signature, `exp`,
  `aud`, and `iss` on every use — never trust an unverified payload.
- Secrets: never in code, commits, logs, or error messages; read from env/vault; rotate on
  suspected leak. `.env` files are always gitignored, never committed.
- CORS: explicit origin allowlist; never `*` combined with `credentials: true`.
- Auth endpoints (login, password reset, token refresh) are rate-limited and return
  generic errors ("invalid credentials", not "user not found" vs "wrong password").
- Compare secrets/tokens in constant time (`crypto.timingSafeEqual` or equivalent); never
  `===`/`==` on secret values.
- Least privilege: scoped API keys/roles, no shared admin credentials, no default creds.
- Session cookies: `HttpOnly`, `Secure`, `SameSite`; invalidate server-side on logout.
- Avoid: logging tokens/passwords/PII, storing secrets in localStorage, hand-rolled crypto,
  security-by-obscurity as the only control, silently swallowed auth failures.
