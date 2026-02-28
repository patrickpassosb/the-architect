# Data Schema — The Architect (MVP)

## Tables

### sessions
| column | type | notes |
|---|---|---|
| id | text (pk) | uuid |
| title | text | optional session name |
| mode | text | architect \| planner \| pitch |
| created_at | datetime | |
| updated_at | datetime | |

### messages
| column | type | notes |
|---|---|---|
| id | text (pk) | uuid |
| session_id | text (fk sessions.id) | indexed |
| role | text | user \| assistant \| system |
| content | text | |
| transcript_source | text | voice \| text |
| created_at | datetime | |

### artifacts
| column | type | notes |
|---|---|---|
| id | text (pk) | uuid |
| session_id | text (fk sessions.id) | indexed |
| kind | text | architecture \| tasks \| pitch |
| title | text | |
| content_md | text | markdown output |
| content_json | text | serialized JSON payload |
| created_at | datetime | |

### jobs (optional)
| column | type | notes |
|---|---|---|
| id | text (pk) | queue job id |
| session_id | text | |
| kind | text | artifact_generation |
| status | text | pending \| active \| completed \| failed |
| error | text | nullable |
| created_at | datetime | |
| updated_at | datetime | |

## API Contracts (MVP)

### POST `/api/sessions`
Create session.

Request:
```json
{ "title": "optional", "mode": "architect" }
```

Response:
```json
{ "id": "sess_123", "mode": "architect" }
```

### POST `/api/sessions/:id/messages`
Send user message/transcript.

Request:
```json
{ "content": "Build me an MVP for X", "source": "voice" }
```

Response:
```json
{
  "assistant": {
    "summary": "...",
    "decision": "...",
    "next_actions": ["...", "..."]
  },
  "queued_jobs": [{ "id": "job_1", "kind": "artifact_generation" }]
}
```

### GET `/api/sessions/:id/artifacts`
List artifacts.

Response:
```json
[
  { "id": "art_1", "kind": "architecture", "title": "System Design v1" }
]
```

### GET `/api/artifacts/:id`
Get artifact content.

Response:
```json
{ "id": "art_1", "kind": "architecture", "content_md": "# ...", "content_json": {} }
```

### POST `/api/voice/synthesize`
Generate voice output for assistant text (ElevenLabs).

Request:
```json
{ "text": "Short assistant response to speak" }
```

Response:
```json
{
  "provider": "elevenlabs",
  "content_type": "audio/mpeg",
  "audio_base64": "..."
}
```

### POST `/api/sessions/:id/build`
Run a Vibe-driven build command using current session context.

Request:
```json
{
  "goal": "Create initial project scaffold based on the architecture",
  "context": "optional extra context",
  "dry_run": false
}
```

Response:
```json
{
  "build_id": "uuid",
  "status": "completed",
  "command": "vibe --workdir ...",
  "exit_code": 0,
  "output": "...",
  "duration_ms": 18234,
  "notes": ["Execution completed."]
}
```
