# Single-container image for the DEISI platform, which runs one container
# per application on one port.  FastAPI serves the API under /api and the
# React build everywhere else (annotation-backend/app/site.py).
# docker-compose keeps using the per-service images (backend + nginx).

# --- Stage 1: build the React SPA -------------------------------------------
FROM node:18-alpine AS frontend
WORKDIR /frontend
COPY annotation_ui/package*.json ./
RUN npm ci
COPY annotation_ui/ ./
# Same origin: the API is mounted under /api by app/site.py.
ENV API_URL=/api
RUN npm run build

# --- Stage 2: Python runtime serving API + SPA ------------------------------
FROM python:3.11-slim
WORKDIR /app

COPY annotation-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY annotation-backend/ .
COPY --from=frontend /frontend/dist ./frontend

# Normalise line endings (Windows CRLF breaks the shebang) and make it executable
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

# entrypoint.sh waits for the database and runs migrations, then runs CMD
ENTRYPOINT ["/app/entrypoint.sh"]

# --forwarded-allow-ips=*: the pod is only reachable through the cluster
#   ingress; trusting its X-Forwarded-For gives the auth rate limiter the
#   real client IP.
CMD ["uvicorn", "--factory", "app.site:create_site", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
