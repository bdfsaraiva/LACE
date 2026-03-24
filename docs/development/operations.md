# Operations

## Docker

### Start

```bash
cp .env.example .env   # fill in required values
docker compose up -d --build
```

### Stop

```bash
docker compose down
```

### Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Health checks

| Service | URL |
|---|---|
| Backend | http://localhost:8000/ |
| Swagger UI | http://localhost:8000/docs |
| Frontend | http://localhost:3721 |

---

## Database

### Migrations

Schema changes are managed exclusively via Alembic. Migrations run automatically at container start. To run them manually:

```bash
cd annotation-backend
alembic upgrade head
```

!!! important
    `Base.metadata.create_all()` is **not** called at startup. All schema changes must be expressed as Alembic migration files under `alembic/versions/`.

### Stamping an existing database

If you have a database that was created outside of Alembic (e.g. from an older `create_all` deployment), stamp it at the correct revision before running migrations:

```bash
alembic stamp <revision_id>
alembic upgrade head
```

### Reset (development)

!!! danger
    This deletes all data.

```bash
docker compose down -v
rm -rf data/
docker compose up -d --build
```

---

## Environment Variables

See the [Configuration reference](../reference/configuration.md) for the full list of environment variables.

!!! warning
    Never commit `.env` to version control. Use secrets management in production.
