# Environment Setup Guide

This guide covers all API keys and environment variables needed to run SuperviseAI with full AI/integration support.

## Quick Start

Copy the example env file and add your keys:

```bash
cp packages/api/.env.example packages/api/.env
```

Then open `packages/api/.env` and add the sections below.

---

## 1. Azure OpenAI (thesis analysis + AI coaching)

```env
AZURE_OPENAI_ENDPOINT=https://<your-resource-name>.openai.azure.com
AZURE_OPENAI_KEY=<your-key>
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

**Where to get it:**

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure OpenAI** → your resource
2. `AZURE_OPENAI_ENDPOINT` — resource Overview page → "Endpoint"
3. `AZURE_OPENAI_KEY` — resource → "Keys and Endpoint" → Key 1
4. `AZURE_OPENAI_DEPLOYMENT` — Azure OpenAI Studio → Deployments → your GPT-4o deployment name

**What it powers:**

- Thesis analysis (progress score, gap report, abstract alignment)
- AI coaching questions generated from the student's actual thesis content
- Mode-specific coaching responses (Mock Viva / Argument Defender / Socratic)
- Citation format validation (Layer 2)
- AI-based session evaluation and readiness scoring

---

## 2. Azure Speech (voice STT + TTS in coaching)

```env
AZURE_SPEECH_KEY=<your-speech-key>
AZURE_SPEECH_REGION=eastus
```

**Where to get it:**

1. [portal.azure.com](https://portal.azure.com) → **Azure AI Services** → Speech → your resource
2. `AZURE_SPEECH_KEY` — Keys and Endpoint → Key 1
3. `AZURE_SPEECH_REGION` — the Azure region your resource is in (e.g. `eastus`, `westeurope`, `uksouth`)

**What it powers:**

- `POST /coaching/tts` — converts AI coaching responses to natural speech (Neural voice)
- `POST /coaching/voice` — transcribes student audio recordings to text

---

## 3. Copyleaks (plagiarism scanning)

```env
COPYLEAKS_EMAIL=<your-copyleaks-account-email>
COPYLEAKS_API_KEY=<your-api-key>
API_BASE_URL=https://<your-public-backend-url>
```

**Where to get it:**

1. Sign up at [copyleaks.com](https://copyleaks.com) → Account → API Access
2. `COPYLEAKS_EMAIL` — your Copyleaks login email
3. `COPYLEAKS_API_KEY` — Copyleaks dashboard → API Key
4. `API_BASE_URL` — **the public URL your backend is reachable at**

> Copyleaks is async: it scans the submission then calls your webhook at
> `{API_BASE_URL}/api/v1/webhooks/copyleaks/{STATUS}/{submissionId}`.
> The backend must be publicly reachable for this to work.

**Local testing with ngrok:**

```bash
ngrok http 3000
# Copy the https://xxxx.ngrok.io URL and set it as API_BASE_URL
```

**What it powers:**

- Real plagiarism scanning with similarity percentage and flagged sections
- Async webhook flow: scan starts on submission, result arrives via `POST /webhooks/copyleaks`
- `plagiarism.ready` Socket.IO event fires when the result is ready

---

## 4. Semantic Scholar (citation existence check)

```env
SEMANTIC_SCHOLAR_API_KEY=<your-key>
```

**Where to get it:**

[semanticscholar.org/product/api](https://www.semanticscholar.org/product/api) → Request API key

> This is optional. Without a key the free tier still works (1 req/sec, up to 100 req/day).
> The app just won't send an API key header. Citation Layer 3 checks still run.

**What it powers:**

- Layer 3 of citation validation: checks whether extracted reference strings actually exist in the Semantic Scholar database
- Results appear in the citation report as unverified citations

---

## Fallback Behaviour (no keys required)

The app runs without any keys. Missing integrations fall back gracefully:

| Feature               | With keys                        | Without keys              |
| --------------------- | -------------------------------- | ------------------------- |
| Thesis analysis       | GPT-4o (semantic, accurate)      | Regex/keyword heuristic   |
| Citation Layer 1      | Regex extraction                 | Same                      |
| Citation Layer 2      | GPT format validation            | Skipped                   |
| Citation Layer 3      | Semantic Scholar existence check | Skipped                   |
| Plagiarism            | Copyleaks async scan             | Sentence-repeat heuristic |
| AI coaching questions | GPT-4o, thesis-specific          | Generic question bank     |
| Coaching responses    | GPT-4o, mode-aware               | Next question from bank   |
| Session evaluation    | GPT-4o readiness score           | Answer-length heuristic   |
| Voice TTS             | Azure Neural voice               | Browser `speechSynthesis` |
| Voice STT             | Azure Speech → `/coaching/voice` | Browser Web Speech API    |

---

## Minimum for a meaningful demo

Only **Azure OpenAI** is needed to show the core AI features:

```env
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

With those three variables set, coaching sessions will generate real thesis-specific questions, give mode-aware feedback, and produce AI-evaluated readiness scores. Plagiarism and citation fall back to heuristics but the coaching experience is fully AI-powered.

---

## Complete `.env` Template

```env
# ── Core ─────────────────────────────────────────────────────────────────────
PORT=3000
DATABASE_URL=postgresql://supervise:supervise@localhost:5433/superviseai
JWT_SECRET=change_this_secret
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
RESET_TOKEN_TTL_MINUTES=30

# ── MinIO (object storage) ────────────────────────────────────────────────────
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_PUBLIC_ENDPOINT=localhost
MINIO_PUBLIC_PORT=9000
MINIO_PUBLIC_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=theses

# ── Azure OpenAI ──────────────────────────────────────────────────────────────
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# ── Azure Speech ──────────────────────────────────────────────────────────────
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=eastus

# ── Copyleaks ─────────────────────────────────────────────────────────────────
COPYLEAKS_EMAIL=
COPYLEAKS_API_KEY=
API_BASE_URL=http://localhost:3000

# ── Semantic Scholar ──────────────────────────────────────────────────────────
SEMANTIC_SCHOLAR_API_KEY=
```
