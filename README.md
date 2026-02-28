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

## Queue + Worker (Agent C MVP)
- Queue contracts: [docs/QUEUE.md](docs/QUEUE.md)
- Local worker flow: [docs/WORKER_LOCAL.md](docs/WORKER_LOCAL.md)
- Deployment steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
