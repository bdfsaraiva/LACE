# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Normalise line endings (Windows CRLF breaks the shebang) and make it executable
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Expose the port the app runs on
EXPOSE 8000

# entrypoint.sh waits for the database and runs migrations, then runs CMD
ENTRYPOINT ["/app/entrypoint.sh"]

# Start the FastAPI application (production: no --reload).
# --forwarded-allow-ips=*: the backend port is not published, so only the
#   nginx container can reach it; trusting its X-Forwarded-For gives the auth
#   rate limiter the real client IP instead of nginx's.
# --root-path /api: nginx serves the API under /api (stripping the prefix),
#   so Swagger UI at /api/docs must load /api/openapi.json.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--root-path", "/api"]