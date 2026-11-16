# DEISI Platform Deployment

The production instance runs on the DEISI platform of Universidade Lusófona
([deploy guide](https://deisi-management.apps.deisi.ulusofona.pt/deploy/)),
with the database hosted on [Neon](https://neon.com) (serverless PostgreSQL).

```
push to main (deisi-org mirror)
  → GitHub Actions (.github/workflows/deploy.yml)
  → platform-orchestrator: docker build (root Dockerfile) → GHCR → Helm → Kubernetes
  → https://<repo-name>.apps.deisi.ulusofona.pt
                     │
                     ▼
              Neon PostgreSQL (DATABASE_URL)
```

---

## How the image works

The platform runs **one container per application on one port**, so the root
`Dockerfile` builds a single image instead of the two used by docker-compose:

| Path | Served by |
|---|---|
| `/api/*` | the FastAPI app (`app.main:app`), mounted by `app/site.py` |
| `/api/docs` | Swagger UI |
| anything else | the React build; unknown paths return `index.html` so client-side routes survive a reload |

At start, `entrypoint.sh` waits for the database, runs `alembic upgrade head`
and then starts uvicorn on port `8000` (`app_port` in `deploy.yml`). The
platform's own PostgreSQL (`database_enabled`) and `migrations_command` are not
used.

---

## One-time setup

### 1. Create the Neon database

1. Create a project in an EU region (e.g. *AWS Europe Central 1 — Frankfurt*), PostgreSQL 17 or newer.
2. Optional but recommended on the Free plan: set the compute size to a fixed
   0.25 CU, so the monthly compute allowance is not spent on autoscaling.
3. Copy the **direct** connection string (connection pooling off). It looks like
   `postgresql://neondb_owner:<password>@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.

!!! note
    Neon suspends the compute after 5 minutes without queries and closes idle
    connections. The engine uses `pool_pre_ping`, so the first request after a
    quiet period reconnects instead of failing; it only waits a few hundred
    milliseconds for the compute to wake up.

### 2. Restore a backup (optional)

Restore a `pg_dump -Fc` archive with a `pg_restore` at least as new as the
`pg_dump` that produced it:

```bash
pg_restore --no-owner --no-privileges --single-transaction \
  -d "postgresql://neondb_owner:<password>@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require" \
  lace.dump
```

`--no-owner --no-privileges` makes the Neon role own every object. The archive
includes `alembic_version`, so the migrations at startup only apply revisions
newer than the backup. Without a backup, the first start creates the schema and
the admin account from `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD`.

### 3. Create the private mirror

The platform only deploys private repositories in the `deisi-org`
organisation, while `bdfsaraiva/LACE` is public. Keep the public repository as
the source and deploy through a private mirror. The mirror does not carry the
public history: each deploy is one snapshot commit with the current tree of
`main`.

```bash
gh repo create deisi-org/lace --private
git remote add deisi https://github.com/deisi-org/lace.git
```

The repository name becomes the hostname: `deisi-org/lace` is served at
`https://lace.apps.deisi.ulusofona.pt`.

### 4. Set the `APP_RUNTIME_ENV` secret

The platform injects this secret into the container as environment variables.
It uses `.env` format, one `KEY=value` per line, **without quotes**. Start from
the template at the repository root, which lists every variable with the
production values:

```bash
cp app-runtime.env.example app-runtime.env
```

Fill in `DATABASE_URL` (the Neon connection string, as shown by Neon) and
`SECRET_KEY` (`python -c "import secrets; print(secrets.token_hex(32))"`).
Add `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` only when starting from an
empty database. Store the secret, then delete the local copy:

```bash
gh secret set APP_RUNTIME_ENV -R deisi-org/lace < app-runtime.env
rm app-runtime.env
```

GitHub never shows a secret's value again; `gh secret list -R deisi-org/lace`
only shows when it was last updated. To change one value, store the whole file
again. Changes take effect on the next deploy (or `gh run rerun` of the last
*Deploy* run); a new `SECRET_KEY` signs every user out.

### 5. Deploy

The first deploy pushes a snapshot of `main` without a parent:

```bash
git push deisi "$(git commit-tree 'main^{tree}' -m 'Deploy LACE')":refs/heads/main
```

Follow the **Deploy** workflow under *Actions* in `deisi-org/lace`; when it is
green, open the public URL and check `/api/docs`.

---

## Day-to-day

Every push to `main` of the mirror redeploys. Pushing to the public repository
does not deploy: the *Deploy* workflow is disabled there, and `docs.yml`
publishes the documentation from the public repository only.

```bash
git push origin main   # public repository
git fetch deisi        # deploy: snapshot of main on top of the mirror
git push deisi "$(git commit-tree 'main^{tree}' -p deisi/main -m 'Deploy LACE')":refs/heads/main
```

!!! note
    A job `if` cannot skip the *Deploy* workflow in the public repository:
    GitHub resolves the private reusable workflow first, so the run fails at
    startup. It was disabled there with
    `gh workflow disable deploy.yml -R bdfsaraiva/LACE`.

Take periodic backups; the Neon Free plan only keeps a short restore window.
`pg_dump` must be at least the server's major version (see `select version();`):

```bash
pg_dump -Fc -d "<direct connection string>" -f lace_$(date +%F).dump
```

---

## Testing the image locally

```bash
docker build -t lace .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL="postgresql+psycopg2://user:password@host.docker.internal:5432/lacedb" \
  -e SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')" \
  -e CORS_ORIGINS='["http://localhost:8000"]' \
  lace
```

Then open <http://localhost:8000> (SPA) and <http://localhost:8000/api/docs>.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Pod never becomes ready; logs repeat `PostgreSQL not ready, retrying in 2s` | Wrong `DATABASE_URL`, or the Neon compute is suspended for exceeding the monthly quota |
| Pod restarts right after `alembic upgrade head` | The migration failed; the entrypoint stops instead of serving an outdated schema |
| Logins fail with HTTP 429 for everyone at once | The ingress hides client IPs, so all users share one auth rate-limit bucket; raise `AUTH_RATE_LIMIT_REQUESTS` |
| Large CSV/JSON imports fail with HTTP 413 | The file exceeds `MAX_UPLOAD_MB`, or a proxy in front of the cluster has a lower body-size limit |
| Page reload shows JSON instead of the app | The request path starts with `/api/`; SPA routes must not |
