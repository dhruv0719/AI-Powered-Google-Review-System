# Staging & Production Deployment Configuration Guide

## Architecture Overview

```mermaid
flowchart LR
    Browser["Customer Mobile Browser"]
    Pages["Cloudflare Pages (SPA Static Assets)"]
    Proxy["Cloudflare Pages Function (/api/* Proxy)"]
    Render["Render Web Service (Fastify Backend)"]
    NeonPool["Neon PostgreSQL (Pooled Endpoint)"]
    NeonDirect["Neon PostgreSQL (Direct Endpoint)"]
    Groq["Groq AI API (openai/gpt-oss-20b)"]

    Browser -->|HTTPS| Pages
    Browser -->|/api/*| Proxy
    Proxy -->|x-proxy-secret + x-forwarded-client-ip| Render
    Render -->|DATABASE_URL (Queries)| NeonPool
    Render -->|MIGRATION_DATABASE_URL (Migrations)| NeonDirect
    Render -->|HTTPS API| Groq
```

---

## 1. Database Connection Separation (Neon PostgreSQL)

Neon uses PgBouncer in transaction pooling mode for connection pooling. Transaction-mode pooling does not support session-level PostgreSQL advisory locks (`pg_advisory_lock`), which our migration runner uses to safely serialize schema migrations across startup containers.

To guarantee zero lock-orphaning and reliable connection pooling, the backend requires two distinct connection strings:

### A. Runtime Query Pool (`DATABASE_URL`)
- **Endpoint:** Neon connection pooler hostname (contains `-pooler` in hostname).
- **Mode:** Transaction pooling (`?sslmode=require`).
- **Used by:** Normal application queries (`createDatabase()`, `getDb()`) via `postgres(url, { max: 10 })`.
- **Example:**
  ```text
  postgresql://user:password@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
  ```

### B. Startup Migration Runner (`MIGRATION_DATABASE_URL`)
- **Endpoint:** Neon direct compute hostname (**MUST NOT** contain `-pooler`).
- **Mode:** Direct session connection (`?sslmode=require`).
- **Used by:** `runMigrations()` on backend startup via dedicated `postgres(migrationUrl, { max: 1 })`.
- **Locking:** Acquires 64-bit session advisory lock `SELECT pg_advisory_lock(847291048201948::bigint)` before running Drizzle migrations, and releases it in `finally`.
- **Production Guard:** If `NODE_ENV=production` and `MIGRATION_DATABASE_URL` is omitted or contains `-pooler`, backend startup fails fast immediately.
- **Example:**
  ```text
  postgresql://user:password@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
  ```

---

## 2. Environment Variables Specification

### Render Web Service (Backend)

| Variable | Required | Staging / Production Value Description |
| :--- | :---: | :--- |
| `NODE_ENV` | Yes | `production` |
| `PORT` | Yes | `10000` (Render default port) |
| `HOST` | Yes | `0.0.0.0` |
| `DATABASE_URL` | Yes | Neon **pooled** connection URI (`-pooler` endpoint) |
| `MIGRATION_DATABASE_URL` | Yes | Neon **direct** connection URI (non-pooler endpoint) |
| `SESSION_SECRET` | Yes | 32+ character cryptographically random string (e.g., 64 hex characters) |
| `INTERNAL_PROXY_SECRET` | Yes | 32+ character secret matching Cloudflare Pages Function binding |
| `COOKIE_SECURE` | Yes | `true` |
| `COOKIE_DOMAIN` | Optional | Set if using custom domain cookie scoping |
| `PUBLIC_WEB_URL` | Yes | Canonical frontend URL: `https://<project>.pages.dev` |
| `ALLOWED_ORIGINS` | Optional | Additional allowed CORS origins |
| `TRUSTED_PROXIES` | Yes | `127.0.0.1,::1` (or Render proxy CIDR) |
| `ENABLE_AI_ASSISTANT` | Yes | `true` |
| `AI_PROVIDER` | Yes | `groq` |
| `AI_MODEL` | Yes | `openai/gpt-oss-20b` |
| `GROQ_API_KEY` | Yes | Production Groq API Key (`gsk_...`) |

### Cloudflare Pages (Frontend + Function Proxy)

| Variable | Required | Value Description |
| :--- | :---: | :--- |
| `BACKEND_URL` | Yes | Render Web Service origin (e.g. `https://<service-name>.onrender.com`) |
| `INTERNAL_PROXY_SECRET` | Yes | Secret matching Render backend `INTERNAL_PROXY_SECRET` |

### Cloudflare Warm-Up Worker (`workers/warmup`)

| Variable | Required | Value Description |
| :--- | :---: | :--- |
| `BACKEND_HEALTH_URL` | Yes | Render `/health` endpoint: `https://<service-name>.onrender.com/health` (NEVER `/ready`) |

---

## 3. Operational Invariants

1. **Proxy Authentication & Direct Access Rejection:**
   In production (`NODE_ENV=production`), direct requests to `/api/*` on Render that do not contain a valid `X-Proxy-Secret` matching `INTERNAL_PROXY_SECRET` are rejected with `403 FORBIDDEN`. Only `/health` and `/ready` are exempt.
2. **Session Advisory Lock Isolation:**
   Migrations never execute against a pooled Neon connection. The dedicated single direct connection ensures that advisory locks are never orphaned across connection pool rotations.
3. **Safe Liveness Probing:**
   The scheduled warm-up worker strictly calls `/health`. It is prohibited from calling `/ready` to avoid waking Neon PostgreSQL during keep-alive pings.
