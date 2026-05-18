# Logjam

A private mapping and logbook app for canyoning in New South Wales.

## About

Canyoning in the Blue Mountains is driven by exploration and discovery in remote wilderness areas. As online information becomes more accessible, preserving that sense of discovery becomes harder. Logjam is a private record-keeping tool — not a publication platform — allowing canyoners to document their own canyon data, trip logs, and route notes without contributing to the spread of sensitive location information.

> _"Be mindful not to publicise 'new' canyons or routes, particularly those in wilderness areas, to preserve opportunities for discovery and to minimise environmental impacts."_
> — NSW National Parks and Wildlife Service

## Features

- **Interactive map** — visualise your canyons on a MapLibre map with multiple layer options
- **Canyon logbook** — store canyon data including coordinates, grade, abseil counts, notes, and custom attributes
- **Trip logs** — record trips with custom fields, photos, and GPX tracks
- **Topo map generation** — generate offline-ready MBTiles topo maps from NSW Spatial Services LiDAR data for import into Gaia GPS
- **Friends & sharing** — connect with friends and share selected canyons with them
- **Private by design** — all data is private to each user by default

## Tech Stack

### Frontend

- React + TypeScript
- MapLibre GL JS
- Vite

### Backend

- Node.js + Express + TypeScript
- Prisma ORM
- PostgreSQL (AWS RDS)
- AWS Cognito (authentication)
- AWS S3 (media storage)
- AWS SQS + ECS Fargate (topo job processing)
- AWS SES (email notifications)

### Infrastructure

- AWS Elastic Beanstalk (API hosting)
- AWS S3 + CloudFront (frontend hosting)
- AWS ECR (container registry)
- Docker

## Project Structure

```
logjam/
├── frontend/          # React/TypeScript frontend
│   └── src/
│       ├── components/
│       │   ├── map/
│       │   └── sidebar/
│       └── ...
└── api/               # Express/TypeScript backend
    ├── src/
    │   ├── middleware/
    │   ├── routes/
    │   ├── services/
    │   └── index.ts
    └── prisma/
        └── schema.prisma
```

## Local Development

The local environment spins up a Postgres database and LocalStack (AWS emulator) via Docker. The API and frontend run on the host for fast hot-reload. No AWS account is needed for the default "fake auth" mode.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose)
- Node.js 20+
- `make` (pre-installed on Linux/Mac; Windows users: use WSL)

### First-time setup

```bash
# 1. Clone and install dependencies
cd shared && npm install && npm run build && cd ..
cd api && npm install && cd ..
cd frontend && npm install && cd ..

# 2. Create your local env file
cp .env.local.example .env.local
# (no edits needed for fake-auth mode)

# 3. Start infra, migrate DB, seed fixtures
make dev
```

Then open two more terminals:

```bash
# Terminal 1 — API
cd api && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173). You're logged in as **alice** with no sign-in prompt.

### Command reference

| Command | What it does |
|---|---|
| `make dev` | Start Postgres + LocalStack, run migrations, seed fixtures |
| `make reset` | Wipe all volumes, restart infra, re-migrate, re-seed |
| `make seed` | Re-run seed without wiping volumes |
| `make down` | Stop infra containers |
| `make snapshot` | Dump + sanitize prod DB into `snapshots/latest.sql` |
| `make dev-snapshot` | Load snapshot into fresh DB, use real Cognito auth |
| `make logs` | Tail Docker infra logs |
| `make help` | List all targets |

### Auth modes

**Fake auth (default for `make dev`)**

No Cognito. The API reads `AUTH_MODE=fake` from `.env.local` and attaches a fixed user to every request. The frontend bypasses Amplify entirely. You're automatically logged in as the active seeded user.

To switch which seeded user you're logged in as, edit `FAKE_USER_SUB` in `.env.local` and restart the API:

```bash
# .env.local
FAKE_USER_SUB=fake-bob-sub   # switch to bob
```

**Real Cognito (`make dev-snapshot`)**

Used with the snapshot workflow. Fill in `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` in `.env.local`, and change `AUTH_MODE=cognito`. Requires a real test account in the Cognito dev pool.

### Seeded test data

The `make dev` seed creates three users with deterministic IDs:

| User | cognitoId | Email | Owns |
|---|---|---|---|
| alice | `fake-alice-sub` | alice@local | 5 canyons, 5 trip logs |
| bob | `fake-bob-sub` | bob@local | — |
| carol | `fake-carol-sub` | carol@local | — |

Relationships:
- alice and bob are **friends** (accepted)
- carol has a **pending** friend request to alice
- alice has **shared** Grand Canyon and Claustral Canyon with bob

Canyons (all owned by alice, all in the Blue Mountains):
1. Grand Canyon — −33.6392, 150.2656 — shared with bob
2. Claustral Canyon — −33.5123, 150.5432 — shared with bob
3. Empress Falls — −33.7345, 150.4123
4. Slot Canyon — −33.6789, 150.3456
5. Deep Pass — −33.7123, 150.2890

### Snapshot workflow

Use this when you need realistic data (real canyon records from prod) without risk of touching prod:

```bash
# 1. Set your prod DB URL (keep this secret — never commit)
export DATABASE_URL_PROD="postgresql://user:pass@prod-host/logjam"

# 2. Dump + sanitize
make snapshot
# → snapshots/latest.sql (gitignored)
# All user emails replaced with user-<id>@local
# Real cognitoIds replaced with sanitized-<id>
# Canyon/trip notes cleared

# 3. Start env with snapshot
make dev-snapshot
```

Verify the sanitization: `grep -i '@' snapshots/latest.sql | grep -v '@local'` should return nothing.

### Topo pipeline (optional)

The topo worker (Python/GDAL/PDAL) is not started by default. Opt in when needed:

```bash
docker compose --profile topo up topo-worker
```

To manually trigger a job against LocalStack:

```bash
aws sqs send-message \
  --endpoint-url http://localhost:4566 \
  --queue-url http://localhost:4566/000000000000/logjam-topo-jobs-local \
  --message-body '{"jobId":"<id>","s3InputKey":"inputs/<id>/upload.zip"}' \
  --region ap-southeast-2
```

### Running integration tests

Tests require the API to be running locally (do `make dev` + `cd api && npm run dev` first):

```bash
cd api && npm test
```

Covers: `/health` 200, `/users/me` returns alice under fake auth, `/canyons` returns seeded data.

### Troubleshooting

**Port conflicts** — default ports: Postgres `5432`, LocalStack `4566`, API `8080`, frontend `5173`. If another process holds a port, stop it or change the port in `.env.local` + `docker-compose.yml`.

**Stale schema after migration** — if you add a migration while Postgres has data, just run `make reset` to wipe + re-migrate + re-seed.

**LocalStack not ready** — if `make dev` fails with LocalStack connection errors, run `docker compose logs localstack` to check startup state. Re-run `make dev` once it stabilises.

**Prisma client out of sync** — after editing `schema.prisma`, run `cd api && npx prisma generate` to regenerate the client before `npm run dev`.

**`shared` changes not picked up** — after editing `shared/`, run `cd shared && npm run build` before restarting the API or frontend.

### Using this environment from Claude

Claude can run:
- `make dev` — start infra (wait for "Infra healthy." output)
- `make reset` — wipe + restart for a clean slate
- `cd api && npm test` — verify API behaviour

The default `AUTH_MODE=fake` with `FAKE_USER_SUB=fake-alice-sub` means all API calls are authenticated as alice. No browser or Cognito account needed for API-level testing.

## Deployment

The app is deployed to AWS in the `ap-southeast-2` (Sydney) region.

| Component          | Service           |
| ------------------ | ----------------- |
| Frontend           | S3 + CloudFront   |
| Backend API        | Elastic Beanstalk |
| Database           | RDS PostgreSQL    |
| Container registry | ECR               |
| Auth               | Cognito           |
| Media storage      | S3                |
| Topo job worker    | ECS Fargate       |

Deployments are triggered automatically via GitHub Actions on push to `main`.

## Topo Map Generation

Logjam includes a pipeline for generating offline topo MBTiles from NSW Spatial Services LiDAR data. See [`topo/README.md`](topo/README.md) for full usage instructions.

Supported input: ELVIS LiDAR ZIP files (DEM + LAZ)
Output: MBTiles files for import into Gaia GPS

## Licence

Private — all rights reserved.
