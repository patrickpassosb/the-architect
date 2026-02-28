# Repository Guidelines for AI Agents

This file provides high-level instructions and patterns for AI agents working within this monorepo.

## Project Structure and Module Organization

The Architect is organized as an npm workspaces monorepo:

- **`apps/web`**: Next.js 15 (App Router) frontend, handles voice capture and UI visualization.
- **`apps/api`**: Fastify HTTP server, handles session orchestration and AI reasoning.
- **`apps/worker`**: BullMQ worker for asynchronous background tasks (artifact generation).
- **`packages/shared-types`**: Central Zod schemas and inferred TypeScript types.
- **`packages/core`**: Common infrastructure (SQLite, Queue, Logger) and domain logic (Mistral provider).

## Coding Conventions

- **Type Safety**: Use Zod for all API boundaries. Export inferred types from `packages/shared-types`.
- **Database Access**: Use the centralized helpers in `packages/core/src/db.ts`. Do not write raw SQL in application code.
- **AI Reasoning**: Maintain the structured-output schema for Mistral responses (`assistantResponseSchema`).
- **Asynchronous Work**: Offload heavy computations (like markdown formatting) to the worker via BullMQ.

## Development and Testing

- **Local Services**: Start Redis using `npm run redis:up`.
- **Monorepo Startup**: Use `npm run dev:all` to launch all services.
- **Verification**: Run `npm run typecheck` and `npm run test:integration` before submitting changes.

## Documentation Requirements

- All public functions and classes must include JSDoc explaining their purpose and logic.
- Architectural changes must be reflected in the `docs/` directory.
- Root configurations and environment variables must be kept up-to-date in `.env.example`.
