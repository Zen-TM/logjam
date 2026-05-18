.PHONY: dev dev-snapshot dev-cognito reset seed snapshot logs down help

# Load .env.local if present (provides AUTH_MODE, FAKE_USER_SUB, Cognito vars etc.)
-include .env.local
export

# ── Primary targets ────────────────────────────────────────────────────────────

## Start full local env (fake auth, seeded fixtures)
dev:
	@echo "Starting infra..."
	docker compose up -d postgres localstack
	@$(MAKE) _wait-healthy
	@echo "Running migrations..."
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma migrate deploy
	@echo "Seeding fixtures..."
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma db seed
	@echo ""
	@echo "  Infra ready. Start app servers in separate terminals:"
	@echo "    Terminal 1: cd api  && npm run dev"
	@echo "    Terminal 2: cd frontend && npm run dev"
	@echo ""
	@echo "  Logged in as: alice (FAKE_USER_SUB=fake-alice-sub)"
	@echo "  Switch user:  FAKE_USER_SUB=fake-bob-sub  (restart api)"

## Start local env with sanitized prod snapshot (real Cognito auth)
dev-snapshot:
	@if [ ! -f snapshots/latest.sql ]; then \
		echo "ERROR: snapshots/latest.sql not found. Run 'make snapshot' first."; \
		exit 1; \
	fi
	@echo "Wiping volumes and restoring snapshot..."
	docker compose down -v
	docker compose up -d postgres localstack
	@$(MAKE) _wait-healthy
	@echo "Restoring snapshot into DB..."
	docker compose exec -T postgres psql -U logjam logjam < snapshots/latest.sql
	@echo "Applying any migrations not present in snapshot..."
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma migrate deploy
	@echo ""
	@echo "  Snapshot loaded. Start app servers:"
	@echo "    Terminal 1: AUTH_MODE=cognito cd api  && npm run dev"
	@echo "    Terminal 2: cd frontend && VITE_AUTH_MODE=cognito npm run dev"

## Reset: wipe DB + LocalStack volumes, restart, re-seed
reset:
	docker compose down -v
	docker compose up -d postgres localstack
	@$(MAKE) _wait-healthy
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma migrate deploy
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma db seed
	@echo "Reset complete."

## Re-run seed without wiping volumes
seed:
	cd api && DATABASE_URL=postgresql://logjam:logjam@localhost:5432/logjam npx prisma db seed

## Dump + sanitize prod DB into snapshots/latest.sql
## Requires DATABASE_URL_PROD env var pointing at the prod RDS instance.
snapshot:
	@if [ -z "$$DATABASE_URL_PROD" ]; then \
		echo "ERROR: DATABASE_URL_PROD is not set."; \
		exit 1; \
	fi
	mkdir -p snapshots
	bash scripts/snapshot.sh

## Tail API logs (if API is running as a background process — otherwise use the terminal)
logs:
	docker compose logs -f

## Stop infra containers
down:
	docker compose down

## Print available targets
help:
	@grep -E '^## ' Makefile | sed 's/## //'

# ── Internal helpers ───────────────────────────────────────────────────────────

_wait-healthy:
	@echo "Waiting for Postgres..."
	@until docker compose exec -T postgres pg_isready -U logjam > /dev/null 2>&1; do sleep 1; done
	@echo "Waiting for LocalStack..."
	@until curl -sf http://localhost:4566/_localstack/health | grep -q running > /dev/null 2>&1; do sleep 2; done
	@echo "Infra healthy."
