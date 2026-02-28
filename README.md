# The Architect

Voice-first AI technical cofounder for hackathons and fast product execution.

## What it is
The Architect is a real-time assistant that helps builders go from idea -> architecture -> execution plan -> deliverable artifacts.

You speak, it responds with:
- technical decisions
- tradeoff analysis
- implementation tasks
- exportable project docs

## Core Purpose
Accelerate high-quality technical decision making under time pressure.

## MVP Scope
- Voice input + transcript
- 3 modes: Architect / Planner / Pitch Coach
- Real-time conversational loop
- Artifact generation (`ARCHITECTURE.md`, `TASKS.md`, `PITCH.md`)
- Project session persistence

## Stack (MVP)
- Frontend: Next.js + React + TypeScript + Tailwind
- API: Fastify + TypeScript
- Worker: BullMQ
- Queue backend: Redis
- Database: SQLite
- AI models: Voxtral (realtime voice), Mistral Large (reasoning)

## Why this architecture
- Fast to ship in hackathon timeline
- Strong developer ergonomics for AI coding agents
- Reliable async processing for long tasks (BullMQ)
- Simple persistence (SQLite) with clean migration path later

## Repository Layout
```txt
apps/
  web/      # Next.js UI
  api/      # Fastify HTTP API + orchestration
  worker/   # BullMQ job processors
packages/
  shared-types/  # zod schemas + TS types
  prompts/       # system and mode prompts
  core/          # orchestration/domain logic
infra/
  docker-compose.yml  # redis + optional local services
docs/
  PRD.md
  ARCHITECTURE.md
  SCHEMA.md
```

## Quick Start Goal
Phase 1 target: local end-to-end loop working
1. user speaks
2. transcript arrives
3. model response generated
4. artifact job queued
5. artifact saved and shown in UI

## Run Entire Project (One Command)
1. Install dependencies:
```bash
npm install
```
2. Create local env file:
```bash
cp .env.example .env
```
3. Start everything (Redis + API + Worker + Web):
```bash
npm run dev
```

Services:
- Web: `http://localhost:3000`
- API: `http://localhost:4000/api/health`
- Worker health: `http://localhost:4100/health`

If ports are already in use and you want auto-cleanup:
```bash
npm run dev:all -- --force
```

---

If this repo is used in a hackathon, prioritize: shipping, reliability, and demo clarity over premature complexity.

## Run API Locally
1. Install dependencies:
```bash
npm install
```
2. Create local env file:
```bash
cp .env.example .env
```
3. Start Redis for BullMQ:
```bash
docker compose -f infra/docker-compose.yml up -d redis
```
4. Start the API:
```bash
npm run dev -w apps/api
```
5. Verify health:
```bash
curl http://localhost:4000/api/health
```

Core routes:
- `GET /api/health`
- `POST /api/sessions`
- `POST /api/sessions/:id/messages`
- `GET /api/sessions/:id/artifacts`
- `GET /api/artifacts/:id`

## Run Web Locally
1. Install dependencies:
```bash
npm install
```
2. Start the API service (required by the web app) on `http://localhost:4000`.
3. Configure web env:
```bash
cat > apps/web/.env.local <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
EOF
```
4. Start the web app:
```bash
npm run dev -w apps/web
```
5. Open `http://localhost:3000`.

Voice notes:
- Use a Chromium-based browser for best Web Speech API support.
- The browser will prompt for microphone permission on first recording attempt.
- To enable voice output, set `ELEVENLABS_API_KEY` in `.env`.
- To enable automated build execution, install Mistral Vibe CLI (`vibe`) on the host running the API.

## Queue + Worker (Agent C MVP)
- Queue contracts: [docs/QUEUE.md](docs/QUEUE.md)
- Local worker flow: [docs/WORKER_LOCAL.md](docs/WORKER_LOCAL.md)
- Deployment steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## MVP Smoke Tests
Run these before pushing to quickly verify the end-to-end loop.

1. Start the full stack:
```bash
npm run dev
```

2. Run one smoke test pass (expects real provider success):
```bash
npm run test:smoke
```

3. Run multiple smoke passes in a loop:
```bash
LOOPS=3 npm run test:smoke:loop
```

Optional knobs:
- `REQUIRE_PROVIDER_SUCCESS=1` fails if `/messages` does not return `200`.
- `ARTIFACT_POLL_ATTEMPTS` and `ARTIFACT_POLL_INTERVAL_MS` control artifact wait timing.
