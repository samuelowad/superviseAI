# SuperviseAI Monorepo (Phase 0)

This repository is now bootstrapped as an npm workspaces monorepo:

- `packages/web` - React + Vite frontend scaffold
- `packages/api` - NestJS API scaffold (JWT auth, TypeORM, MinIO service, route stubs)
- `packages/shared` - shared TypeScript models used by web + API

## Quick start

```bash
npm install
cp .env.root.example .env
npm run dev
```

Run backend infrastructure:

```bash
docker compose up --build
```

## Quality gates

- ESLint + Prettier are configured at repo root.
- Husky pre-commit hook runs `lint-staged`.
- Format all files: `npm run format`.
- Lint all workspaces: `npm run lint`.

## Backend endpoints (Phase 0)

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- Stubbed protected modules: `submissions`, `analysis`, `coaching`, `milestones`, `dashboard`.
