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
- **GeoPDF export** — generate geo-referenced topo PDFs (GPS-aware, for field map apps)
- **Friends & sharing** — connect with friends and share selected canyons with them
- **Private by design** — all data is private to each user by default

## Tech Stack

### Frontend

- React 19 + TypeScript
- Vite
- MapLibre GL JS (map rendering)
- MUI (Material UI) components
- AWS Amplify (Cognito auth client)

### Backend (API)

- Node.js + Express 5 + TypeScript
- Prisma ORM (driver adapter: `@prisma/adapter-pg`)
- PostgreSQL (AWS RDS in prod)
- zod (env + input validation), pino (logging)

### Topo pipeline

- Python + GDAL + PDAL (LiDAR → DEM/contour processing)
- tippecanoe (MBTiles/PMTiles tiling)
- Runs as on-demand ECS Fargate workers

### Shared

- `shared/` TypeScript package of cross-package types/utils (consumed by api + frontend, mirrored by topo)

### AWS

- Cognito (auth) · S3 (media + topo artifacts) · CloudFront (SPA + tile/API CDN, +WAF)
- ECS Fargate (topo/export/geo-pdf workers) · Elastic Beanstalk (API) · ECR (images)
- RDS (Postgres) · Secrets Manager (DB creds + Resend API key) · Resend (transactional email)

### Infrastructure as Code & local dev

- **Terraform** — single source of truth for all AWS infra (`infra/terraform/`); the same modules provision MiniStack S3 + ECS task defs for local dev
- Docker + Docker Compose (local Postgres + MiniStack)
- Vitest (unit/integration tests across api, frontend, shared)

## Project Structure

```
logjam/
├── api/                    # Express 5 + Prisma + TypeScript backend
│   ├── prisma/             # schema.prisma + migrations
│   └── src/
│       ├── constants/
│       ├── lib/            # env, auth access, reapers, ecsRunTask, logger, ...
│       ├── middleware/     # auth, errorHandler, rateLimit
│       ├── routes/         # one file per resource
│       ├── services/       # prisma, awsClients, email, ...
│       ├── worker/         # geoPdfWorker (runs as an ECS task)
│       ├── __tests__/      # integration tests (need a running local API)
│       ├── boot.ts         # prod entrypoint (resolve DB secret, migrate, start)
│       └── index.ts        # app bootstrap + route registration
├── frontend/               # React 19 + Vite + MapLibre + MUI
│   └── src/
│       ├── components/      # map, sidebar, dialogs, ...
│       ├── csvImport/       # CSV/RopeWiki import
│       ├── errors/ · styles/
│       └── canyonUtils.ts, useAuth.ts, ...
├── shared/                 # cross-package TS types/utils (geoPdf*, elvisZip, ...)
│   └── src/                # built to shared/dist (api + frontend import from there)
├── topo/                   # Python/GDAL/PDAL MBTiles pipeline (ECS workers)
│   ├── renderers/ · SVTM/ · icons/
│   ├── worker.py · export_worker.py · pipeline.py
│   └── Dockerfile
├── infra/terraform/        # IaC — single source of truth (see its README)
│   ├── bootstrap/          # creates the S3 state bucket
│   ├── modules/storage/    # reusable S3 bucket module (prod + local)
│   ├── envs/prod/          # real AWS (S3 backend)
│   ├── envs/local/         # MiniStack S3 + ECS task defs + generates root .env.local
│   └── templates/
├── scripts/                # snapshot, log-retention, task-def template
├── docs/                   # audits, etc.
├── docker-compose.yml      # local Postgres + MiniStack
└── Makefile                # dev / reset / snapshot targets
```

## Local Development

The local environment spins up a Postgres database and MiniStack (a free, open-source LocalStack-compatible AWS emulator) via Docker. The API and frontend run on the host for fast hot-reload. No AWS account is needed for the default "fake auth" mode. Unlike LocalStack Community, MiniStack's ECS RunTask launches real worker containers, so topo/export/GeoPDF jobs run locally exactly as in prod.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose)
- Node.js 20+
- [Terraform](https://developer.hashicorp.com/terraform/install) 1.10+ — `make dev`/`make reset` use it to provision the MiniStack S3 buckets + ECS task defs and generate `.env.local`
- `make` (pre-installed on Linux/Mac; Windows users: use WSL)

### First-time setup

```bash
# 1. Clone and install dependencies
cd shared && npm install && npm run build && cd ..
cd api && npm install && cd ..
cd frontend && npm install && cp .env.example .env && cd ..

# 2. Build worker images + start infra: Postgres + MiniStack, provision S3 + ECS
#    task defs + generate .env.local (via Terraform), migrate DB, seed fixtures.
#    (First run builds the GDAL/PDAL worker image — slow; cached thereafter.)
make dev
```

`.env.local` is **generated by Terraform** during `make dev` — don't create it by
hand (it's gitignored and overwritten on each `make dev`/`make reset`). To change
a dev value, edit `infra/terraform/envs/local/env-files.tf` (and add new vars to
both `api/src/lib/env.ts` and `infra/terraform/templates/env.local.tftpl`).

The **frontend** reads its own gitignored `frontend/.env` (Vite, not Terraform);
step 1 copies it from `frontend/.env.example`, which defaults `VITE_AUTH_MODE=fake`
for local dev. Without it the SPA falls back to Cognito and won't auto-login.

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
| `make dev` | Build worker images, start Postgres + MiniStack, provision S3 + ECS task defs + generate `.env.local` (Terraform), run migrations, seed fixtures |
| `make build-workers` | Build the worker Docker images (`logjam-topo-worker`, `logjam-api`) that MiniStack RunTask launches; rebuild after changing worker code |
| `make reset` | Wipe all volumes + local TF state, restart infra, re-provision, re-migrate, re-seed |
| `make seed` | Re-run seed without wiping volumes |
| `make down` | Stop infra containers |
| `make snapshot` | Dump + sanitize prod DB into `snapshots/latest.sql` |
| `make dev-snapshot` | Load snapshot into fresh DB, use real Cognito auth |
| `make logs` | Tail Docker infra logs |
| `make help` | List all targets |

### Auth modes

**Fake auth (default for `make dev`)**

No Cognito. The API reads `AUTH_MODE=fake` from `.env.local` and attaches a fixed user to every request. The frontend bypasses Amplify entirely. You're automatically logged in as the active seeded user.

To switch which seeded user you're logged in as, restart the API with an override (`.env.local` is Terraform-generated, so a hand edit there is overwritten on the next `make dev`):

```bash
cd api && FAKE_USER_SUB=fake-bob-sub npm run dev   # switch to bob
```

(For a persistent default, change `fake_user_sub` in `infra/terraform/envs/local/env-files.tf`.)

**Real Cognito (`make dev-snapshot`)**

Used with the snapshot workflow. `make dev-snapshot` loads the sanitized snapshot and then **prints** the commands to start the servers — you run the API and frontend yourself with the override (`AUTH_MODE=cognito` for the API, `VITE_AUTH_MODE=cognito` for the frontend). The Cognito pool/client IDs are already populated in the generated `.env.local` (they're public identifiers baked into the Terraform template). Requires a real test account in the Cognito dev pool. See the `make dev-snapshot` row above.

### Seeded test data

The `make dev` seed creates three users with deterministic IDs:

| User | cognitoId | Email |
|---|---|---|
| alice | `fake-alice-sub` | alice@local |
| bob | `fake-bob-sub` | bob@local |
| carol | `fake-carol-sub` | carol@local |

The dataset is a rich synthetic fixture (realistic volume + edge cases so prod data
is never needed for development): **alice** owns ~28 canyons — mostly well-published
NSW classics, plus a couple of deliberately fabricated ones — and ~100 fabricated
trip logs (3–4 per canyon plus a few named no-canyon trips). **bob** and **carol**
each own a handful of their own. Exact records (names, coordinates, grades) live in
`api/prisma/seed.ts`; treat that file as the source of truth rather than this summary.

Stable invariants the integration suite relies on (see the header comment in
`api/prisma/seed.ts` and `api/src/__tests__/_actors.ts`) — these never change:
- alice and bob are **friends** (accepted); carol has a **pending** friend request to alice.
- alice has **shared** Grand Canyon and Claustral Canyon (her two anchor canyons) with bob.
- carol is shared **nothing** and is not alice's friend (the "stranger" perspective).

### Snapshot workflow

Use this when you need realistic data (real canyon records from prod) without risk of touching prod:

```bash
# 1. Set your prod DB connection params (keep these secret — never commit;
#    fetch the password from Secrets Manager)
export DB_HOST_PROD="prod-host"
export DB_NAME_PROD="logjam"
export DB_USER_PROD="logjam_admin"
export DB_PASSWORD_PROD="..."

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

### Topo / export / GeoPDF jobs

Jobs run automatically. Submitting a topo, export, or GeoPDF job in the UI makes
the API call ECS RunTask, and MiniStack launches the corresponding worker
container (`logjam-topo-worker` / `logjam-api`) on the `logjam-local` network —
the same flow as prod. The worker reaches Postgres and S3 by container name,
processes the job, writes output to MiniStack S3, and updates the job row.

Prerequisites: the worker images must exist (`make dev` builds them, or run
`make build-workers`), and a heavy LiDAR topo job additionally needs its input
LiDAR ZIP uploaded plus the SVTM formation GeoTIFF seeded at
`s3://logjam-topo-local/svtm/svtm_formation.tif`. Watch running workers with
`docker ps`; tail one with `docker logs -f <container>`.

To debug a GeoPDF job in-process instead of in a container, use
`make geo-pdf-run JOB=<geoPdfJobId>`.

### Running tests

#### Unit tests (no infra needed)

These run with Prisma/AWS mocked — no `make dev`, no database, no server:

| Suite | Command |
|---|---|
| api unit | `cd api && npm run test:unit` |
| shared | `cd shared && npm test` |
| frontend | `cd frontend && npm test` |
| topo | `cd topo && python -m unittest discover -s tests` |

#### Integration tests

Tests require the API to be running locally (do `make dev` + `cd api && npm run dev` first):

```bash
cd api && npm test
```

Covers: `/health` 200, `/users/me` returns alice under fake auth, `/canyons` returns seeded data, and the share/friend boundaries from the recipient's side.

By default every fake-auth request is **alice**. To act as another seeded user (bob/carol — e.g. to exercise sharing), send an `x-fake-sub` header (honored only in `AUTH_MODE=fake`):

```bash
curl -H 'Authorization: Bearer x' -H 'x-fake-sub: fake-bob-sub' localhost:8080/canyons/shared
```

Integration tests use the `as(SUB)` helper in `api/src/__tests__/_actors.ts` for this. The suite hits an in-process rate limit (300 req/user/min) — let it drain or restart the API between rapid re-runs.

### CI/CD

GitHub Actions (`.github/workflows/`):

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | every PR + push to `main` | unit tests, lint, typecheck for `shared`/`api`/`frontend`/`topo` (integration tests stay local — they need `make dev`) |
| `terraform-ci.yml` | PRs touching `infra/terraform/**` | `terraform fmt -check` + `validate` (no AWS access) |
| `terraform-plan.yml` | PRs touching `infra/terraform/**` | read-only `terraform plan` against prod, posted as a PR comment; applies stay manual |
| `deploy-api.yml` / `deploy-frontend.yml` / `deploy-topo-worker.yml` | push to `main` (path-filtered) | build + deploy to ECR/EB, S3+CloudFront, ECR respectively |

### Troubleshooting

**Port conflicts** — default ports: Postgres `5432`, MiniStack `4566`, API `8080`, frontend `5173`. If another process holds a port, stop it or change the port in `.env.local` + `docker-compose.yml`.

**Stale schema after migration** — if you add a migration while Postgres has data, just run `make reset` to wipe + re-migrate + re-seed.

**MiniStack not ready** — if `make dev` fails with AWS connection errors, run `docker compose logs ministack` to check startup state. Re-run `make dev` once it stabilises.

**Workers don't launch** — confirm the worker images exist (`docker images | grep logjam`) and rebuild with `make build-workers` if missing. MiniStack needs the Docker socket (mounted in `docker-compose.yml`) to spawn them.

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

Logjam is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](LICENSE). Notably, if you run a modified version as
a network service, AGPL-3.0 requires you to make your modified source available
to its users.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening issues or pull requests.
