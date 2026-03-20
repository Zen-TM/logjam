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

### Prerequisites

- Node.js 20+
- npm
- Docker Desktop
- AWS CLI (configured with a `logjam` profile)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd api
npm install
npx prisma generate
npm run dev
```

The API runs on `http://localhost:8080` by default.

### Environment variables

Create `api/.env` with the following:

```env
DATABASE_URL="postgresql://..."
COGNITO_USER_POOL_ID=ap-southeast-2_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=ap-southeast-2
AWS_REGION=ap-southeast-2
S3_BUCKET_MEDIA=logjam-media
S3_BUCKET_TOPO=logjam-topo-jobs
NODE_ENV=development
PORT=8080
```

Never commit `.env` to version control.

### Running with Docker

```bash
cd api
docker build -t logjam-api .
docker run -p 8080:8080 --env-file .env logjam-api
```

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
