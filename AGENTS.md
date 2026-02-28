# Repository Guidelines

## Project Structure & Module Organization
This repo is an npm workspaces monorepo.
- `apps/web`: Next.js 15 frontend (App Router) for voice input, session UI, and artifact rendering.
- `apps/api`: Fastify API for sessions/messages/artifacts orchestration.
- `apps/worker`: BullMQ worker for async artifact jobs.
- `packages/shared-types`: shared Zod schemas and TypeScript types used across web/api/worker.
- `packages/core`: shared backend domain/infrastructure helpers.
- `infra/`: local infra (Redis via Docker Compose).
- `docs/`: PRD, architecture, schema, queue, and deployment docs.

## Build, Test, and Development Commands
From repo root:
- `npm install`: install all workspace dependencies.
- `npm run redis:up`: start Redis for queue workflows.
- `npm run dev:api`: run Fastify API in watch mode.
- `npm run dev:worker`: run BullMQ worker in watch mode.
- `npm run dev -w apps/web`: run frontend on `http://localhost:3000`.
- `npm run build`: build all workspaces.
- `npm run typecheck`: run TypeScript checks across workspaces.
- `npm run test`: run workspace test scripts (currently placeholders).

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode).
- Indentation: 2 spaces; keep files ASCII unless needed.
- React components: `PascalCase`; hooks/utilities: `camelCase` (example: `useVoiceTranscript`).
- Zod schemas: `camelCase` with `Schema` suffix (example: `sendMessageRequestSchema`).
- Keep API contracts centralized in `packages/shared-types`; do not duplicate shapes in apps.
- Web linting uses `next/core-web-vitals` (`apps/web/.eslintrc.json`).

## Testing Guidelines
No formal test suite is configured yet. Minimum contribution checks:
- `npm run typecheck`
- `npm run build`
- manual smoke test of changed runtime path (web, API route, or worker flow).
When adding tests, colocate them near source (`*.test.ts` / `*.test.tsx`) and prefer deterministic unit tests for shared types/core logic.

## Commit & Pull Request Guidelines
There is no established commit history yet; use Conventional Commits going forward (e.g., `feat(web): add voice transcript submit`).
PRs should include:
- concise summary of behavior change,
- affected workspaces (`apps/web`, `apps/api`, etc.),
- validation steps/commands run,
- screenshots or short recordings for UI changes,
- linked issue/task when available.

## Security & Configuration Tips
- Copy `.env.example` to `.env`; use `apps/web/.env.local` for frontend env vars.
- Never commit secrets or local env files.
- Run `npm audit` before release; document accepted residual risks in PR notes.
