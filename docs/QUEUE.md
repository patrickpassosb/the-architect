# Queue Integration Contracts

## Queue Names
- Queue: `artifact_generation`
- Job name: `artifact_generation`

## Producer Integration
- API path (current contract): `POST /api/sessions/:id/messages`
- Worker-safe enqueue helper: `enqueueArtifactGenerationJob()` from `@the-architect/core`
- Queue implementation shared in `packages/core/src/queue.ts`

## Payload Schema
```json
{
  "session": {
    "id": "sess_123",
    "mode": "architect",
    "title": "Optional session title"
  },
  "context": {
    "user_input": "Build me an MVP architecture for X",
    "assistant": {
      "summary": "Short summary",
      "decision": "Recommended decision",
      "next_actions": ["Action 1", "Action 2"]
    },
    "artifact_kinds": ["architecture", "tasks"],
    "metadata": {
      "message_id": "msg_123"
    }
  }
}
```

## Worker Behavior
- Validates payload with shared zod schema (`artifactGenerationJobPayloadSchema`)
- Ensures session exists in SQLite
- Generates one artifact record per `context.artifact_kinds` entry
- Persists:
  - `content_md` as Markdown
  - `content_json` as serialized JSON string
- Updates `jobs` table state:
  - `pending` (enqueue)
  - `active` (processing)
  - `completed` or `failed`

## Retry/Backoff
- Attempts: `5`
- Backoff: `exponential`
- Initial delay: `2000ms`

## Example Direct Enqueue (Node)
```bash
node -e '
const { createArtifactQueue, enqueueArtifactGenerationJob } = require("@the-architect/core");
(async () => {
  const queue = createArtifactQueue("redis://127.0.0.1:6379");
  await enqueueArtifactGenerationJob(queue, {
    session: { id: "sess_demo_1", mode: "architect", title: "Demo Session" },
    context: {
      user_input: "Design a hackathon MVP",
      assistant: {
        summary: "Need fast architecture",
        decision: "Use managed services",
        next_actions: ["Define scope", "Implement API", "Prepare demo"]
      },
      artifact_kinds: ["architecture", "tasks"]
    }
  });
  await queue.close();
})();'
```
