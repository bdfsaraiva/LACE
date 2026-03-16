# Operations

## Environment
Use .env at repo root for Docker or local dev. Required values:
- DATABASE_URL
- CORS_ORIGINS
- SECRET_KEY (min 32 chars)
- REACT_APP_API_URL

Optional values:
- FIRST_ADMIN_USERNAME
- FIRST_ADMIN_PASSWORD

## Docker build and run
```bash
cp .env.example .env
docker compose up -d --build
```

## Health checks
- Backend: http://localhost:8000/
- API docs: http://localhost:8000/docs
- Frontend: http://localhost:3721

## Logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## Database reset
```bash
docker compose down -v
Remove-Item -Recurse -Force .\data\
docker compose up -d --build
```
