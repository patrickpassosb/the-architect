# Architecture — The Architect (MVP)

## High-Level Flow
```txt
Browser (mic + UI)
  -> API (session/orchestration)
    -> Mistral Large (reasoning + structured response)
    -> BullMQ enqueue (artifact generation)
      -> Worker processes artifact job
        -> SQLite stores artifacts/session state
  <- API JSON responses back to Browser
```

## Architecture Diagram (Mermaid)
```mermaid
flowchart LR
  W[Next.js Web\napps/web] -->|POST /api/sessions| A[Fastify API\napps/api]
  W -->|POST /api/sessions/:id/messages| A
  W -->|GET artifacts| A
  A -->|chat/completions| M[Mistral API]
  A -->|enqueue artifact_generation| Q[(Redis + BullMQ)]
  Q --> WK[Worker\napps/worker]
  A --> DB[(SQLite)]
  WK --> DB
  W <-->|artifact list/detail| A
```

## Components

### 1) Web App (`apps/web`)
- Captures voice input via browser speech API
- Sends text/voice transcript messages
- Displays assistant response + artifact list/detail
- Handles mode switching (Architect/Planner/Pitch)

### 2) API Service (`apps/api`)
- Session management
- Message intake endpoint
- Mistral orchestration + schema validation
- Queue producer for artifact generation jobs

### 3) Worker Service (`apps/worker`)
- Consumes BullMQ jobs
- Generates artifact markdown + JSON payload
- Persists artifacts and job status in SQLite

### 4) Shared Packages
- `shared-types`: zod schemas + inferred TS types
- `core`: reusable DB/queue/mistral/artifact logic

## Queue Use Cases
- Artifact generation jobs
- Retry-safe async tasks without blocking API latency

## Storage (SQLite)
- sessions
- messages
- artifacts
- jobs

## MVP Reliability Rules
- Every endpoint returns typed JSON
- Model output validated against schema
- Failed jobs retry with exponential backoff
