# SuperviseAI

SuperviseAI is an AI-powered thesis supervision platform built for universities and research cohorts. It combines structured supervision workflows for professors with guided improvement tools for students, including thesis analysis, citation checks, plagiarism monitoring, and viva preparation.

## What It Does

- Centralizes thesis progress tracking across versions.
- Gives students faster feedback loops before final submission.
- Provides professor-side oversight without spreadsheet-heavy workflows.
- Supports platform governance with role-based access (`student`, `professor`, `admin`).

## How It Works

1. A user creates an account and signs in.
2. The API issues JWT tokens and enforces role-based route access.
3. Students and professors enter dedicated app shells with guarded navigation.
4. Backend services persist user/session data in PostgreSQL and file assets in MinIO.

## Tech Stack

- Frontend: React + Vite + TypeScript
- Backend: NestJS + TypeORM + PostgreSQL
- Storage: MinIO (S3-compatible)
- Infra: Docker Compose
- Quality: ESLint, Prettier, Husky + lint-staged

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Start infrastructure

```bash
npm run infra:build
```

This starts `postgres`, `minio`, and `nestjs-api`.

### 3) Run apps locally

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000/api/v1`

## Seeding the Database

Seed creates/updates baseline users and ensures `users` + `password_resets` tables exist.

### Seed from host

```bash
DATABASE_URL=postgresql://supervise:supervise@localhost:5433/superviseai npm run db:seed
```

### Seed from API container

```bash
docker compose exec nestjs-api npm run seed -w @supervise-ai/api
```

## Default Seed Users

- `admin@superviseai.local`
- `professor@superviseai.local`
- `student@superviseai.local`

Default password for all seeded users:

- `SuperviseAI123!`

Override seed password before running:

```bash
SEED_USER_PASSWORD='YourStrongPassword123!' npm run db:seed
```

## Developer Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run format
```

## Commit Hook Behavior

Pre-commit runs lint-staged with formatting + ESLint autofix.

- Warnings do **not** block commits.
- ESLint errors (or command failures) **do** block commits.
