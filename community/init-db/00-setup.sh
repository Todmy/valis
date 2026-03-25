#!/bin/bash
# Apply all Teamind migrations in order
# This runs automatically when the postgres container starts for the first time

set -e

echo "Applying Teamind migrations..."

for f in /docker-entrypoint-initdb.d/migrations/*.sql; do
  echo "  Applying $(basename $f)..."
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

echo "All migrations applied successfully."
