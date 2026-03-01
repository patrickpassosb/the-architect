# Deployment Plan

## Target Topology (Cloud Run)
- Frontend: Vercel
- API: Cloud Run service (`the-architect-api`)
- Worker: Cloud Run service (`the-architect-worker`) with min instance `1`
- Redis: Managed Redis (Google Memorystore preferred)
- Database: SQLite file for MVP (mounted volume or ephemeral for demos); move to Postgres for production

## Required Environment Variables
Shared:
- `REDIS_URL` (e.g. `redis://<host>:6379`)
- `DATABASE_URL` (e.g. `/var/data/the-architect.sqlite` or `./data/the-architect.sqlite`)

API:
- `PORT` (Cloud Run injects this; default app fallback is `8080`)
- `HOST` (`0.0.0.0`)
- `SERVICE_NAME=api`
- `MISTRAL_API_KEY`
- `MISTRAL_MODEL` (default `mistral-large-latest`)
- `MISTRAL_API_URL` (default `https://api.mistral.ai/v1/chat/completions`)
- `ELEVENLABS_API_KEY` (required for voice output)
- `ELEVENLABS_VOICE_ID` (optional, default `JBFqnCBsd6RMkjVDRZzb`)
- `ELEVENLABS_MODEL_ID` (optional, default `eleven_multilingual_v2`)

Worker:
- `WORKER_PORT` (set to `8080` for Cloud Run; worker exposes `/health`)
- `WORKER_CONCURRENCY` (default `4`)
- `SERVICE_NAME=worker`

## Build and Deploy (Cloud Run)
Assumes GCP project already configured (`gcloud config set project <PROJECT_ID>`).

### 1) Build and push API image
```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/the-architect-api -f apps/api/Dockerfile .
```

### 2) Deploy API service
```bash
gcloud run deploy the-architect-api \
  --image gcr.io/<PROJECT_ID>/the-architect-api \
  --region <REGION> \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars REDIS_URL="redis://<REDIS_HOST>:6379",DATABASE_URL="/var/data/the-architect.sqlite",HOST="0.0.0.0",SERVICE_NAME="api"
```

### 3) Build and push Worker image
```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/the-architect-worker -f apps/worker/Dockerfile .
```

### 4) Deploy Worker service
```bash
gcloud run deploy the-architect-worker \
  --image gcr.io/<PROJECT_ID>/the-architect-worker \
  --region <REGION> \
  --platform managed \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --set-env-vars REDIS_URL="redis://<REDIS_HOST>:6379",DATABASE_URL="/var/data/the-architect.sqlite",WORKER_PORT="8080",WORKER_CONCURRENCY="4",SERVICE_NAME="worker"
```

Notes:
- Worker runs as a long-lived queue consumer and exposes a basic HTTP health endpoint for Cloud Run readiness.
- For MVP demos, SQLite persistence can be ephemeral. For durable prod behavior, move to managed Postgres.

## Local Development
- Redis: `docker compose -f infra/docker-compose.yml up -d redis`
- API: `npm run dev:api`
- Worker: `npm run dev:worker`

See [WORKER_LOCAL.md](./WORKER_LOCAL.md) for full local queue test flow.

## Railway Fallback
If Cloud Run setup is blocked, deploy API and Worker as separate Railway services using the same env vars:
- API start command: `npm run start -w apps/api`
- Worker start command: `npm run start -w apps/worker`
- Keep the same `REDIS_URL`, `DATABASE_URL`, and `WORKER_CONCURRENCY` contract so no code changes are required.
