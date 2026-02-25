# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperviseAI is an AI-powered thesis supervision platform with three roles:

- **Professor**: dashboard, student detail view, analytics, milestone management
- **Student**: thesis upload, automated analysis results, AI coaching (chat + voice), submission history
- **Admin**: platform governance, professor verification, user moderation, system oversight

The system is a **frontend + backend monorepo-style project** (two separate apps, coordinated here). The `agents/` directory contains staff-level specs that govern implementation.

## Architecture

### Frontend (`react-agent.md` spec)

- **Stack**: React 18 + TypeScript, Vite, React Router v6, TanStack Query, Tailwind CSS
- **Auth**: Backend-issued JWT (no direct DB access from client)
- **Realtime**: Socket.IO client (primary), with a polling fallback
- **Structure**: Feature-sliced (`features/auth`, `features/submissions`, `features/coach`, `features/professor`, `features/history`, `features/admin`) with a `shared/` layer for API, guards, UI primitives, and DTOs
- **API rule**: Zero direct calls from client to AI/plagiarism APIs. All data flows through the backend.

### Backend (`node-agent.md` spec)

- **Stack**: NestJS + TypeScript, PostgreSQL (via TypeORM), MinIO (S3-compatible object storage), Socket.IO gateway, Multer, Docker Compose
- **Auth**: Local JWT (`passport-jwt` + `@nestjs/jwt`); bcrypt password hashing; attaches `{ id, email, role }` to each request
- **Structure**: Domain modules (`auth`, `users`, `admin`, `cohorts`, `submissions`, `analysis`, `coaching`, `storage`, `parsing`) + an `integrations/` layer (Azure, Copyleaks, Semantic Scholar)
- **Clean boundary rule**: Controllers handle HTTP contract only; Services own domain logic; Integrations are pure API clients with no business logic; Pipeline handles background steps and event emission
- **No external BaaS** — fully self-hosted; no Supabase anywhere

### External Integrations

| Service                  | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| Azure OpenAI (GPT-4o)    | Thesis analysis, citation validation, coaching            |
| Azure Speech             | STT (`/coaching/voice`) and TTS (`/coaching/tts`)         |
| Azure Cognitive Services | Sentiment / confidence signals                            |
| Copyleaks                | Plagiarism scanning (async via webhook)                   |
| Semantic Scholar         | Citation existence check (Layer 3 of citation validation) |
| Socket.IO                | Real-time pipeline event delivery                         |

### Self-Hosted Infrastructure

| Service        | Purpose                                               |
| -------------- | ----------------------------------------------------- |
| PostgreSQL     | Primary database (TypeORM)                            |
| MinIO          | Object storage for uploaded PDFs/DOCX (S3-compatible) |
| Docker Compose | Orchestrates `postgres` + `minio` + `nestjs-api`      |

## Core Data Flow

### Submission Pipeline

1. `POST /api/v1/submissions` — validate file type/size, upload pdf/docx to MinIO at `theses/{studentId}/{submissionId}.pdf`, store `file_key` in DB, extract text
2. Insert submission row (`status = processing`, `file_key`, `extracted_text`)
3. Run in parallel (background): ThesisTrack (GPT-4o), Citation Validator (3-layer), Plagiarism start (Copyleaks)
4. Emit Socket.IO events to `user:{studentId}` room: `submission.created`, `submission.stage`, `submission.complete`, `submission.failed`, `plagiarism.ready`
5. Copyleaks reports arrive via webhook at `POST /api/v1/webhooks/copyleaks`

### Frontend Processing UX

- POST submit → navigate to `/student/results/:submissionId` (processing state)
- Show stepper: Upload → Extract → ThesisTrack → Citations → Done
- Plagiarism badge shows "pending" until `plagiarism.ready` event

## Running the Stack

```bash
docker compose up --build
```

Required env vars: `DATABASE_URL`, `JWT_SECRET`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `AZURE_*`, `COPYLEAKS_*`

---

## API Conventions

- All protected routes require `Authorization: Bearer <jwtAccessToken>`
- Uniform error shape: `{ "error": { "code": "STRING", "message": "STRING", "details": {} } }`
- ThesisTrack returns strict JSON validated against a schema; invalid JSON triggers one retry with a "fix JSON" prompt
- Analysis results (thesis, citations, plagiarism) must be unique per `submission_id` — use upserts, never duplicate rows

## Coaching Guardrails

Every coaching session is **scoped to a specific submission**. The `intent-guard.service.ts` runs before every LLM call and classifies the message as `on_topic_answer | clarification | off_topic | malicious_or_irrelevant`. Off-topic or malicious messages are rejected without calling the main LLM.

Three coaching modes: `mock_viva`, `argument_defender`, `socratic` — each has its own system prompt in `coaching/prompts/`.

## Security Requirements

- Passwords hashed with bcrypt; `password_hash` never returned in any response DTO
- JWT expiry enforced; secret from env only
- File type validation (PDF/DOCX only) and max size limit enforced at upload
- Never render raw HTML from AI responses in the frontend
- Never store thesis text in `localStorage`
- Role guards (`@Roles('student')`, `@Roles('professor')`, `@Roles('admin')`) on every protected route
- Ownership checks in services (students can only access their own submissions/sessions)
- Never leak secrets or stack traces to the client
- Admin cannot be created via public registration; first admin is seeded manually or via controlled bootstrap
- Professor verification is admin-controlled (`is_verified=true` required before supervision assignment)

## Key Files / Specs

- `agents/react-agent.md` — complete frontend spec (routing, component structure, API patterns, state management)
- `agents/node-agent.md` — complete backend spec (module structure, pipeline, coaching, auth)
- `docs/arch.html` — visual architecture diagram
