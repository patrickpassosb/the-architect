# The Architect — Build Prompt (MVP, Cloud Run-ready)

This prompt provides high-level instructions for building and extending **The Architect**, a voice-first AI technical cofounder.

## Product Goals

- **Voice-First Experience**: Real-time microphone capture and transcription from day one.
- **AI-Driven Reasoning**: Real-time technical assistance using Mistral Large for system design.
- **Asynchronous Artifacts**: Non-blocking generation of technical documents (Markdown + JSON).
- **Session-Based Workflows**: Persistence of conversation history and technical decisions.

## Architecture and Stack

- **Frontend**: Next.js 15 (App Router) with Tailwind CSS.
- **Backend**: Fastify API for session management and AI orchestration.
- **Background Jobs**: BullMQ with Redis for artifact generation.
- **Persistence**: SQLite for all relational data.
- **Shared Types**: Centralized Zod schemas in `packages/shared-types`.
- **Core Library**: Reusable infrastructure helpers in `packages/core`.

## Implementation Constraints

- **npm Workspaces**: A plain monorepo structure (no Turborepo for simplicity).
- **Stateless Containers**: Dockerfiles for API and Worker must be Cloud Run-ready.
- **Type Safety**: Full Zod validation for all API and queue boundaries.
- **Reliability**: Exponential backoff for all background jobs via BullMQ.

## Key System Paths

- **Session Creation**: `POST /api/sessions` (API).
- **Message Interaction**: `POST /api/sessions/:id/messages` (API calls Mistral).
- **Artifact Generation**: Triggered by message interaction, processed by `apps/worker`.
- **Data Persistence**: Artifacts are stored in `artifacts` table (Markdown + JSON).

## Developer Experience

- **Startup**: `npm run dev:all` starts the full stack (Web, API, Worker).
- **Tests**: `npm run test:integration` validates the end-to-end flow.
- **Infrastructure**: `infra/docker-compose.yml` provides a local Redis instance.
