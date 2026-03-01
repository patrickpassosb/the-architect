# AGENTS.md

Operational manual for human and AI agents working on `the-architect`.

This document is intentionally broad and practical. It should be sufficient for an agent to:
- understand the product and architecture,
- run the full stack locally,
- implement safe changes across workspaces,
- validate those changes,
- debug common failures quickly,
- prepare deployment-ready updates.

---

## 1) Mission and Product Context

`The Architect` is a voice-first technical copilot.  
Core flow:
1. User sends voice/text input in web UI.
2. API stores message and requests assistant response from Mistral.
3. API enqueues artifact generation job in BullMQ.
4. Worker consumes queue job and writes artifacts to SQLite.
5. Web UI renders assistant response and artifacts.

Primary delivery goals:
- fast local iteration for hackathon-speed execution,
- typed contracts between services,
- graceful degradation when queue/provider has issues.

---

## 2) Monorepo Layout

This repo uses npm workspaces.

- `apps/web`
  - Next.js 15 App Router frontend.
  - Handles voice capture, text input, session UX, artifact rendering.
- `apps/api`
  - Fastify API.
  - Owns sessions/messages/artifacts routes and enqueue orchestration.
- `apps/worker`
  - BullMQ worker.
  - Owns asynchronous artifact generation and health endpoint.
- `packages/shared-types`
  - Zod schemas and TS types used by web/api/worker.
- `packages/core`
  - Shared backend domain code (db, queue, mistral client, artifact generation, logger).
- `infra`
  - Docker Compose files for Redis and app-stack integration loop.
- `docs`
  - Architecture, schema, queue contracts, deployment, and workflow docs.
- `scripts`
  - Operational scripts (`dev-all.sh`, `agent-docker-loop.sh`).
- `tests`
  - Integration script (`tests/integration.mjs`).

---

## 3) Source of Truth and Precedence

When there is inconsistency:
1. Runtime code in `apps/*` and `packages/*` is the source of truth.
2. Then `README.md`.
3. Then `docs/*.md`.
4. This file should be updated whenever runtime behavior changes.

Never preserve stale docs knowingly.

---

## 4) Local Environment Requirements

- Node.js 20+ recommended.
- npm (workspace-aware).
- Docker + Docker Compose (for Redis and containerized integration loop).
- Linux/macOS shell expected by scripts.
- `fuser` utility is used by `scripts/dev-all.sh` for port checks.

---

## 5) Environment Variables

Root `.env.example`:

```env
HOST=0.0.0.0
PORT=4000
WORKER_PORT=4100
DATABASE_URL=./data/the-architect.sqlite
REDIS_URL=redis://127.0.0.1:6379
MISTRAL_API_KEY=replace_with_real_key
MISTRAL_MODEL=mistral-large-latest
MISTRAL_API_URL=https://api.mistral.ai/v1/chat/completions
ELEVENLABS_API_KEY=replace_with_real_key
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

Rules:
- API listens on `PORT` (default `4000`).
- Worker listens on `WORKER_PORT` (default `4100`).
- `DATABASE_URL` can be relative, absolute, `file:...`, `sqlite://...`, or `:memory:`.
- Relative `DATABASE_URL` values are normalized to repo-root absolute paths at startup in API and Worker.
- `apps/web/.env.local` must define:
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`

---

## 6) Core Commands

From repo root:

- Install deps:
  - `npm install`
- Build everything:
  - `npm run build`
- Typecheck everything:
  - `npm run typecheck`
- Start Redis only:
  - `npm run redis:up`
- Stop Redis:
  - `npm run redis:down`
- Start full local stack (Redis + API + Worker + Web):
  - `npm run dev`
- Start full stack with aggressive local cleanup:
  - `npm run dev:all -- --force`
- API only:
  - `npm run dev:api`
- Worker only:
  - `npm run dev:worker`
- Web only:
  - `npm run dev -w apps/web`
- Integration loop (Docker app stack + tests):
  - `npm run workflow:docker-loop`

Health endpoints:
- API: `http://localhost:4000/api/health`
- Worker: `http://localhost:4100/health`
- Web: `http://localhost:3000`

---

## 7) Runtime Architecture and Contracts

### 7.1 Web (`apps/web`)

Responsibilities:
- Create session.
- Send text/voice message.
- Render assistant response and artifacts.
- Show voice/browser/API errors.

Important files:
- `apps/web/app/page.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/hooks/useVoiceTranscript.ts`
- `apps/web/app/layout.tsx`

Notes:
- Browser speech support is best in Chromium-based browsers.
- Root layout uses hydration warning suppression on `<body>` to avoid extension-induced mismatch noise.

### 7.2 API (`apps/api`)

Responsibilities:
- Validate request/response schema.
- Persist sessions/messages.
- Orchestrate Mistral response.
- Enqueue artifact generation jobs.
- Read/list artifacts.

Key route contract:
- `GET /api/health`
- `POST /api/sessions`
- `POST /api/sessions/:id/messages`
- `GET /api/sessions/:id/artifacts`
- `GET /api/artifacts/:id`

Behavioral details:
- If `MISTRAL_API_KEY` is missing, `POST /api/sessions/:id/messages` returns `500`.
- Mistral request has a timeout race (15s) with local fallback assistant response.
- Queue enqueue has timeout protection (2s). If enqueue fails, response can still be `200` with empty `queued_jobs`.
- API maps mode to artifact kind:
  - `architect -> architecture`
  - `planner -> tasks`
  - `pitch -> pitch`

### 7.3 Worker (`apps/worker`)

Responsibilities:
- Consume `artifact_generation` jobs.
- Validate payload via shared schema.
- Ensure session exists.
- Generate artifact markdown/json.
- Persist artifact and job status updates.
- Expose `/health`.

Config:
- Uses `WORKER_PORT` (not `PORT`) for its health server.
- Default concurrency: `4`.

### 7.4 Shared Types (`packages/shared-types`)

Authoritative schema layer:
- modes, sources, artifact kinds, job kinds,
- API request/response schemas,
- queue payload schemas.

Rule:
- Any API/queue shape change must start here, then propagate.

### 7.5 Shared Core (`packages/core`)

Provides:
- SQLite helpers and migrations (`db.ts`)
- Queue setup/enqueue defaults (`queue.ts`)
- Mistral client (`mistral.ts`)
- Artifact generation (`artifacts.ts`)
- Logger (`logger.ts`)

Queue defaults:
- attempts: `5`
- backoff: exponential, delay `2000ms`

---

## 8) Data Model Summary

SQLite tables:
- `sessions`
- `messages`
- `artifacts`
- `jobs`

Important columns:
- `artifacts.content_md` and `artifacts.content_json` are both required.
- `jobs.status` is one of: `pending | active | completed | failed`.

Migrations run automatically at API/Worker startup.

---

## 9) Agent Operating Procedure (Default Workflow)

When implementing any change:
1. Read this file and relevant docs/code for the touched path.
2. Confirm current behavior from code, not assumptions.
3. Implement smallest coherent change set.
4. Run targeted checks first, then broader checks.
5. Update docs if behavior/contracts changed.
6. Summarize what changed, why, and how it was validated.

For non-trivial changes, validate at least:
- `npm run typecheck`
- relevant runtime path smoke test

For cross-service changes, also run:
- `npm run workflow:docker-loop`

---

## 10) Change Impact Matrix

Use this to avoid partial updates.

- If you change API request/response shape:
  - update `packages/shared-types`
  - update `apps/api`
  - update `apps/web/src/lib/api.ts` and consumers
  - update docs (`docs/SCHEMA.md`, README if user-facing)

- If you change queue payload shape:
  - update `packages/shared-types`
  - update API enqueue call
  - update worker job parser/usage
  - update `docs/QUEUE.md`

- If you change DB schema:
  - update `packages/core/src/db.ts` migrations
  - verify old DB compatibility path
  - run local flow creating/reading data
  - update `docs/SCHEMA.md`

- If you change env vars:
  - update `.env.example`
  - update README + deployment docs
  - verify script compatibility (`dev-all`, Docker compose)

- If you change service ports:
  - update code config defaults
  - update compose files and docs
  - check port collision handling in `scripts/dev-all.sh`

---

## 11) Validation Gates

### 11.1 Minimum gate for any code change
- `npm run typecheck`
- `npm run build` if compile/runtime behavior changed

### 11.2 Runtime gate (recommended)
- Run full local stack:
  - `npm run dev`
- Verify:
  - web loads,
  - can create session,
  - can send text message,
  - assistant response appears,
  - artifact list eventually updates.

### 11.3 Integration gate for multi-service work
- `npm run workflow:docker-loop`

This validates:
- API health,
- worker health,
- session creation,
- artifact listing,
- message endpoint deterministic behavior.

---

## 12) Troubleshooting Playbooks

### 12.1 App does not start

Symptoms:
- ports already in use,
- dev scripts exit quickly.

Actions:
1. Run `npm run dev:all -- --force` for automatic cleanup.
2. Check conflicting listeners on ports `3000`, `4000`, `4100`.
3. Ensure Docker daemon is running for Redis startup.

### 12.2 API returns `MISTRAL_API_KEY is not configured`

Actions:
1. Set valid `MISTRAL_API_KEY` in root `.env`.
2. Restart API process.

### 12.3 Assistant response appears but no artifacts

Possible cause:
- enqueue failure; API still responds with assistant output and empty `queued_jobs`.

Actions:
1. Check API logs for enqueue timeout/error.
2. Check Redis availability.
3. Check worker process and worker `/health`.
4. Inspect `jobs` table statuses.

### 12.4 Worker health endpoint unavailable

Actions:
1. Confirm `WORKER_PORT` is set or defaulting to `4100`.
2. Ensure no conflict on worker port.
3. Restart worker and inspect logs.

### 12.5 Hydration warning in web

Notes:
- Browser extensions may inject attributes causing hydration warnings.
- Root layout suppresses known extension-caused body mismatches.

### 12.6 SQLite write issues

Actions:
1. Verify `DATABASE_URL` path is writable.
2. If local file is locked/permission-broken, use `npm run dev:all -- --force`.
3. Confirm relative path resolution points to expected repo path.

---

## 13) Coding Standards and Conventions

- Language: TypeScript strict.
- Indentation: 2 spaces.
- Keep files ASCII unless non-ASCII is clearly needed.
- React components: `PascalCase`.
- Hooks/utilities/functions: `camelCase`.
- Zod schema variables: `camelCase` + `Schema`.
- Prefer sharing contracts in `packages/shared-types`, do not duplicate shape definitions.
- Keep business logic in `packages/core` where reuse across API/Worker is useful.

UI guidance:
- Preserve established visual language and CSS patterns in existing web app unless explicitly redesigning.

---

## 14) Testing Guidance

Current state:
- Workspace `test` scripts are mostly placeholders.
- Integration coverage is in `tests/integration.mjs`.

When adding tests:
- colocate near source (`*.test.ts`, `*.test.tsx`) for unit tests,
- prefer deterministic tests for shared types/core logic,
- avoid flaky real-network dependencies in fast test paths.

---

## 15) Security and Secrets

- Never commit `.env`, `.env.local`, API keys, or tokens.
- Treat `.env.example` as template only.
- Do not log secrets.
- Keep CORS/security changes explicit and documented.

---

## 16) Deployment Notes

Primary documented target:
- API + Worker on Cloud Run,
- Web on Vercel,
- Redis managed,
- SQLite for MVP (migrate to Postgres for durable production).

Worker deployment note:
- Set `WORKER_PORT=8080` for Cloud Run container contract.

If deployment env vars change, update:
- `.env.example`,
- `docs/DEPLOYMENT.md`,
- related compose/service manifests.

---

## 17) Documentation Update Rules

Update docs in the same change when behavior/contracts change.

At minimum:
- `README.md` for user-facing run/deploy changes.
- `docs/SCHEMA.md` for table/API shape changes.
- `docs/QUEUE.md` for queue payload/retry changes.
- `docs/DEPLOYMENT.md` for env/port/runtime changes.
- `AGENTS.md` for agent workflow/rules changes.

---

## 18) Pull Request and Commit Guidance

Use Conventional Commits, e.g.:
- `feat(web): add voice transcript submit`
- `fix(worker): use WORKER_PORT for health server`
- `docs(agents): expand operational runbook`

PR should include:
- concise behavior summary,
- affected workspaces,
- validation commands and outcomes,
- screenshots for UI changes,
- linked task/issue when available.

---

## 19) Definition of Done (Agent Checklist)

Before marking work complete:
1. Code builds/typechecks for affected workspaces.
2. Runtime path was smoke tested (or explicitly state why not).
3. Contracts remain consistent across shared-types/api/web/worker.
4. Docs updated for any behavioral/contract/env changes.
5. No secrets committed.
6. Diffs are focused; no unrelated reversions.

---

## 20) Fast Start for New Agents

1. `npm install`
2. `cp .env.example .env`
3. `cat > apps/web/.env.local <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
EOF`
4. `npm run dev`
5. Open `http://localhost:3000`
6. Validate API and worker health endpoints.

If blocked:
- run `npm run workflow:docker-loop` for a containerized validation path.
