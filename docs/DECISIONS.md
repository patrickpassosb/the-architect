# Decisions (2026-02-28)

## Confirmed by Patrick
- Input mode: **Real microphone from day one**
- Model integration: **Real Mistral integration immediately**
- Package manager: **npm**
- Priority: **Ship MVP as fast as possible, then iterate**
- Deployment target preference:
  - Frontend: **Vercel**
  - Backend: **Google Cloud Run** (preferred) or Railway

## Architecture choice for speed
- Monorepo style: **plain minimal npm workspaces** (no Turborepo for MVP)
- Database: **SQLite**
- Queue: **BullMQ + Redis**
