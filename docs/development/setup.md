# Development Setup

## Prerequisites

| Tool | Minimum version |
|---|---|
| Python | 3.11 |
| Node.js | 18 |
| Docker + Docker Compose | 24 / 2 (optional, for full-stack) |

---

## Backend

```bash
cd annotation-backend
python -m venv .venv
```

=== "Linux / macOS"
    ```bash
    source .venv/bin/activate
    ```

=== "Windows"
    ```bash
    .venv\Scripts\activate
    ```

```bash
pip install -r requirements.txt
```

Copy the environment file and edit as needed:

=== "Linux / macOS"
    ```bash
    cp ../.env.example ../.env
    ```

=== "Windows"
    ```bash
    copy .env.example .env
    ```

Run the development server (hot-reload enabled):

```bash
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000` and Swagger UI at `http://localhost:8000/docs`.

!!! note
    On first startup the backend applies Alembic migrations and creates the admin account from `FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD` in `.env`.

---

## Frontend

```bash
cd annotation_ui
npm install
npm start
```

The dev server runs at `http://localhost:3721` and proxies `/api/*` requests to `http://localhost:8000`.

---

## Full Stack with Docker (recommended)

=== "Linux / macOS"
    ```bash
    cp .env.example .env
    docker compose up -d --build
    ```

=== "Windows"
    ```bash
    copy .env.example .env
    docker compose up -d --build
    ```

| Service | URL |
|---|---|
| Frontend | http://localhost:3721 |
| Backend API | http://localhost:8000 |
| Swagger docs | http://localhost:8000/docs |

Rebuild after code changes:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```
