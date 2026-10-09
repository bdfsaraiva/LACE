# Annotation UI

Web interface for chat annotation and inter-annotator agreement (IAA).

## Setup
```bash
cd annotation_ui
npm install
```

## Configure .env
```bash
cp .env.example .env
```

Edit .env if the backend runs on another machine:
```env
API_URL=http://192.168.1.100:8000
```

## Run locally
```bash
npm start
```

The UI will be available at http://localhost:3721

## Docker
From the repository root:
```bash
docker compose up -d --build
```

The image is built with `API_URL=/api`; nginx (`nginx.conf`) serves the app and proxies `/api/*` to the backend.

## Notes
- The frontend expects the backend API at API_URL (read at build time)
- If you change .env, restart the dev server
