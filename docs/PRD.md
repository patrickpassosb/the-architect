# PRD — The Architect (MVP)

## Product Vision
A voice-first AI technical cofounder that helps builders turn rough ideas into executable technical plans in minutes.

## Problem
Hackathon teams and solo founders lose time on:
- unclear scope
- poor architecture decisions
- weak execution sequencing
- last-minute pitch chaos

## Target Users
1. Hackathon builders (primary)
2. Solo technical founders
3. Small product teams validating prototypes

## Jobs To Be Done
- "Help me choose architecture for this app under 24h constraints"
- "Turn this idea into a concrete sprint plan"
- "Generate a clear technical + pitch narrative"

## MVP Features
1. Voice conversation loop
2. Mode selection:
   - Architect (system design + tradeoffs)
   - Planner (execution plan + task sequencing)
   - Pitch Coach (demo script + differentiation)
3. Artifact generation/export
4. Session history persistence

## Non-Goals (MVP)
- Full autonomous coding/deployment
- Multi-tenant enterprise controls
- Advanced team collaboration features

## Success Criteria (Hackathon)
- End-to-end demo works reliably on stage
- <= 3 seconds average response start time after speech end (target)
- At least 3 useful artifacts generated in one session
- Judges can understand value in < 60 seconds

## Risks
- Realtime audio integration complexity
- Latency spikes from multiple model calls
- Prompt drift to generic outputs

## Mitigations
- Build text fallback path
- Use queue for heavy artifact jobs
- Strict structured-output schemas + mode prompts
