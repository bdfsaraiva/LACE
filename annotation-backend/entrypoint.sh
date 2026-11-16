#!/bin/sh

# Stop on the first failed step: a failed migration must not start the server.
set -e

# Wait for the database to be ready
if echo "$DATABASE_URL" | grep -q "postgresql"; then
    echo "Waiting for PostgreSQL..."
    until python -c "
import sys, os
try:
    import psycopg2
    url = os.environ['DATABASE_URL'].replace('postgresql+psycopg2://', 'postgresql://')
    psycopg2.connect(url)
    sys.exit(0)
except Exception as e:
    print(e)
    sys.exit(1)
" 2>&1; do
        echo "PostgreSQL not ready, retrying in 2s..."
        sleep 2
    done
    echo "PostgreSQL ready."
else
    sleep 2
fi

# Run database migrations
alembic upgrade head

# Start the server given as the image CMD: the API alone
# (annotation-backend/Dockerfile) or API + SPA (root Dockerfile).
exec "$@"
