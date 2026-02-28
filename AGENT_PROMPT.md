# The Architect — Build Prompt (MVP, Cloud Run-ready)

You are a senior full-stack coding agent. Build a working MVP called **The Architect**.

## Product
Voice-first AI technical cofounder for hackathons.

Core loop:
1. User speaks in browser microphone.
2. Backend receives transcript/text and calls real Mistral APIs.
3. Assistant returns structured CTO-style response.
4. Backend enqueues artifact generation jobs.
5. Worker generates artifacts in **Markdown + JSON** and stores them.
6. Frontend displays conversation + artifacts.

## Non-negotiable constraints
- Real microphone from day 1 (no text-only MVP)
- Real Mistral integration immediately (no mock provider)
- Package manager: **npm**
- Monorepo: **plain npm workspaces** (no Turborepo)
- Persistence: **SQLite**
- Queue: **BullMQ + Redis**
- Deployment target: **Frontend on Vercel, Backend/Worker on Google Cloud Run**
- Prioritize “working MVP end-to-end” over polish

## Repo structure to implement

```txt
the-architect/
  apps/
    web/                # Next.js + TS + Tailwind
    api/                # Fastify + TS
    worker/             # BullMQ worker + TS
  packages/
    shared-types/       # zod schemas + TS types
    prompts/            # system + mode prompts
    core/               # orchestration helpers
  infra/
    docker-compose.yml  # local Redis
  docs/
    PRD.md
    ARCHITECTURE.md
    SCHEMA.md
    DECISIONS.md
```

## Technical requirements

### 1) API + data model
Implement SQLite schema based on docs, with artifact dual format:
- sessions
- messages
- artifacts:
  - `content_md` (TEXT)
  - `content_json` (TEXT storing JSON string)
- jobs (optional but recommended)

### 2) Endpoints
Implement:
- `POST /api/sessions`
- `POST /api/sessions/:id/messages`
- `GET /api/sessions/:id/artifacts`
- `GET /api/artifacts/:id`
- `GET /api/health`

`POST /messages` behavior:
- accept source: `voice | text`
- call real Mistral model for structured response
- return:
  - summary
  - decision
  - next_actions[]
- enqueue artifact generation job

### 3) Realtime voice in frontend
- Browser mic capture from day 1
- Push-to-talk or click-to-record (simple + reliable)
- Send transcript/text to backend
- Show assistant output
- Show artifact list and open detail panel

Note: If full realtime streaming is complex, implement robust capture + send pipeline first, then iterate.

### 4) Queue + worker
- BullMQ queue in API
- Redis backend (local docker compose)
- Worker consumes `artifact_generation`
- Worker writes both markdown and JSON artifact fields
- Retry policy with backoff

### 5) Mistral integration
- Add provider module in `packages/core`
- Read env vars from `.env`
- Use real Mistral API calls now
- Keep provider interface clean for future model switching

### 6) Types/contracts
- Use zod in `packages/shared-types`
- Infer TS types from zod
- Validate all API inputs/outputs

### 7) Cloud Run readiness
- Provide Dockerfiles for `apps/api` and `apps/worker`
- Keep stateless service design
- Add scripts and docs for Cloud Run deployment
- Include `PORT` handling and health endpoint

### 8) Developer experience
- npm workspaces root scripts:
  - `npm run dev`
  - `npm run build`
  - `npm run lint`
  - `npm run test`
- Add `.env.example` with required vars
- Add concise run instructions in README

## Deliverables expected now
1. Working local MVP (web + api + worker + redis + sqlite)
2. Real Mistral-backed response path
3. Voice input path from frontend
4. Artifact generation in markdown + JSON
5. Cloud Run deploy instructions for api/worker

## Execution method
- Work in small verifiable increments.
- After each increment, output:
  - what changed
  - what was tested
  - next step
- If blocked, propose 2 concrete options and continue with safest default.

## First execution plan (must follow)
1. Bootstrap npm workspace + packages
2. Implement shared types + schema + sqlite access
3. Implement Fastify API endpoints + health
4. Integrate Mistral provider in API message flow
5. Add Redis + BullMQ + worker + artifact generation
6. Implement Next.js UI with mic capture + conversation + artifacts
7. Add local run scripts + env docs
8. Add Cloud Run Dockerfiles + deployment docs

Start now.
