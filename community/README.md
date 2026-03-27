# Valis Community Edition

Self-hosted Valis with Docker Compose. Your data stays on your infrastructure.

## Quick Start

```bash
# 1. Start the infrastructure
cd community
docker compose up -d

# 2. Wait for services to be healthy (~10 seconds)
docker compose ps

# 3. Install and init Valis CLI
npm install -g valis
valis init
# Choose: Community
# Supabase URL: http://localhost:54321
# Service Role Key: valis_local_dev
# Qdrant URL: http://localhost:6333
# Qdrant API Key: (leave empty for local)
```

## What's Included

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | 5432 | Decision storage, RLS, audit trail |
| Qdrant 1.12 | 6333 (REST), 6334 (gRPC) | Vector search with BM25 |

All 7 database migrations (001-007) are applied automatically on first start.

## Configuration

### Environment Variables

Edit `docker-compose.yml` to change defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `valis` | Database name |
| `POSTGRES_USER` | `valis` | Database user |
| `POSTGRES_PASSWORD` | `valis_local_dev` | Database password |

### Valis CLI Config

After `valis init` with Community mode, your config is at `~/.valis/config.json`:

```json
{
  "supabase_url": "http://localhost:54321",
  "supabase_service_role_key": "valis_local_dev",
  "qdrant_url": "http://localhost:6333",
  "qdrant_api_key": ""
}
```

## Data Persistence

Data is stored in Docker volumes:
- `postgres_data` — all decisions, orgs, members, audit trail
- `qdrant_data` — vector search index

To backup:
```bash
docker compose exec postgres pg_dump -U valis valis > backup.sql
```

To restore:
```bash
docker compose exec -T postgres psql -U valis valis < backup.sql
```

## Stopping

```bash
docker compose down        # Stop services (data preserved)
docker compose down -v     # Stop and DELETE all data
```

## Differences from Hosted Mode

| Feature | Hosted | Community |
|---------|--------|-----------|
| Setup | Zero-config | Docker Compose + credentials |
| Edge Functions | Cloud (13 functions) | Not needed (CLI uses service_role) |
| Search | Qdrant Cloud (server-side embeddings) | Local Qdrant (zero vectors, BM25 fallback) |
| Push | Supabase Realtime (cloud) | Not available (pull-only) |
| Billing | Stripe integration | No limits |
| Data location | Supabase + Qdrant Cloud | Your machine |

## Upgrading

When Valis releases new migrations:

```bash
docker compose down
# Copy new migration files to community/init-db/migrations/
docker compose up -d
# New migrations apply automatically on fresh DB
# For existing DB, apply manually:
docker compose exec -T postgres psql -U valis valis < new_migration.sql
```
