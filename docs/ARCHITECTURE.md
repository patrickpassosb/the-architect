# Architecture — The Architect (MVP)

## High-Level Flow
```txt
Browser (mic + UI)
  -> API (session/orchestration)
    -> Voxtral realtime (speech understanding)
    -> Mistral Large (reasoning + structured response)
    -> BullMQ enqueue (artifact generation)
      -> Worker processes artifact job
        -> SQLite stores artifacts/session state
  <- API streams response/events back to Browser
```

## Components

### 1) Web App (`apps/web`)
- Captures voice/audio input
- Displays live transcript + assistant response
- Shows artifact list and download actions
- Handles mode switching (Architect/Planner/Pitch)

### 2) API Service (`apps/api`)
- Session management
- Message intake endpoint
- Model orchestration pipeline
- Queue producer for heavy jobs
- SSE/WebSocket event stream for UI updates

### 3) Worker Service (`apps/worker`)
- Consumes BullMQ jobs
- Generates artifacts (md/json)
- Persists results in SQLite
- Emits completion events

### 4) Shared Packages
- `shared-types`: zod schemas + inferred TS types
- `prompts`: system prompts and mode prompts
- `core`: reusable domain logic

## Queue Use Cases
- Long artifact generation
- Multi-step synthesis jobs
- Retry-safe tasks that should not block real-time UX

## Storage (SQLite)
- sessions
- messages
- artifacts
- jobs (optional app-level tracking)

## MVP Reliability Rules
- Every endpoint returns typed JSON
- Every model output must validate against schema
- Failed jobs retry with exponential backoff
- If realtime fails, fallback to text flow
