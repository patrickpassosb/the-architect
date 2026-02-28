# Worker Local Run

## Prerequisites
- Node 20+
- Docker (for local Redis)

## 1) Install dependencies
```bash
npm install
```

## 2) Start Redis
```bash
npm run redis:up
```

## 3) Run API and Worker
In terminal 1:
```bash
npm run dev:api
```

In terminal 2:
```bash
npm run dev:worker
```

If you only want to validate queue consumption, API is optional and you can run just the worker.

## 4) Enqueue a test job
```bash
node -e '
const { createArtifactQueue, enqueueArtifactGenerationJob } = require("@the-architect/core");
(async () => {
  const queue = createArtifactQueue("redis://127.0.0.1:6379");
  await enqueueArtifactGenerationJob(queue, {
    session: { id: "sess_local_1", mode: "architect" },
    context: {
      user_input: "Create an architecture plan",
      assistant: {
        summary: "A concise architecture",
        decision: "Use API + Worker + Redis",
        next_actions: ["Create queue", "Run worker"]
      },
      artifact_kinds: ["architecture"]
    }
  });
  await queue.close();
})();'
```

## 5) Verify output
- Worker logs should show job completion.
- SQLite DB file defaults to `./data/the-architect.sqlite`.
- `artifacts` table should contain both `content_md` and `content_json`.

Optional quick query:
```bash
sqlite3 ./data/the-architect.sqlite "SELECT id, session_id, kind, length(content_md), length(content_json) FROM artifacts ORDER BY created_at DESC LIMIT 5;"
```

## Stop Redis
```bash
npm run redis:down
```
