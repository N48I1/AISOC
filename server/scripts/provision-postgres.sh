#!/usr/bin/env bash
# =============================================================================
# Provision native PostgreSQL + pgvector for AISOC on a Debian/Ubuntu host.
# =============================================================================
# Coexists with MISP's MariaDB (different engine, different port: PG 5432 vs
# MariaDB 3306). Run as a user with sudo. Idempotent-ish: safe to re-run, but it
# will not overwrite an existing role/database.
#
#   sudo bash scripts/provision-postgres.sh
#
# Override defaults via env:
#   PG_DB=soc PG_USER=aisoc PG_PASSWORD='strong-pw' bash scripts/provision-postgres.sh
# =============================================================================
set -euo pipefail

PG_DB="${PG_DB:-soc}"
PG_USER="${PG_USER:-aisoc}"
PG_PASSWORD="${PG_PASSWORD:-}"

if [[ -z "$PG_PASSWORD" ]]; then
  echo "ERROR: set PG_PASSWORD env var to a strong password before running." >&2
  echo "  e.g.  PG_PASSWORD='$(openssl rand -base64 18 2>/dev/null || echo CHANGE_ME)' sudo -E bash scripts/provision-postgres.sh" >&2
  exit 1
fi

echo "==> Installing PostgreSQL server + contrib"
apt-get update -y
apt-get install -y postgresql postgresql-contrib

# Detect installed major version (e.g. 16) to pull the matching pgvector package.
PG_MAJOR="$(ls /usr/lib/postgresql/ 2>/dev/null | sort -n | tail -1 || true)"
echo "==> Detected PostgreSQL major version: ${PG_MAJOR:-unknown}"

echo "==> Installing pgvector extension"
if ! apt-get install -y "postgresql-${PG_MAJOR}-pgvector" 2>/dev/null; then
  echo "    Package postgresql-${PG_MAJOR}-pgvector unavailable — building pgvector from source"
  apt-get install -y git build-essential "postgresql-server-dev-${PG_MAJOR}"
  tmp="$(mktemp -d)"; git clone --depth 1 https://github.com/pgvector/pgvector.git "$tmp/pgvector"
  make -C "$tmp/pgvector"; make -C "$tmp/pgvector" install; rm -rf "$tmp"
fi

systemctl enable --now postgresql

echo "==> Creating role '${PG_USER}' and database '${PG_DB}'"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}';
  ELSE
    ALTER ROLE ${PG_USER} WITH PASSWORD '${PG_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${PG_DB} OWNER ${PG_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${PG_DB}')\gexec
SQL

echo "==> Enabling pgvector inside '${PG_DB}'"
sudo -u postgres psql -d "${PG_DB}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "==> Confirming PostgreSQL is listening (and not colliding with MariaDB:3306)"
ss -tlnp 2>/dev/null | grep -E '5432|3306' || true

cat <<DONE

✓ PostgreSQL + pgvector provisioned.
  Database : ${PG_DB}
  Role     : ${PG_USER}
  Port     : 5432

Next:
  1. Put the credentials in .env:
       PGHOST=127.0.0.1
       PGPORT=5432
       PGUSER=${PG_USER}
       PGPASSWORD=********
       PGDATABASE=${PG_DB}
  2. Apply the schema (the server also does this automatically on first boot):
       sudo -u postgres psql -d ${PG_DB} -f db/schema.sql
  3. (Optional) migrate existing SQLite data:
       SOC_DB_PATH=./soc.db npm run db:migrate
  4. Start the app:  npm run dev
DONE
