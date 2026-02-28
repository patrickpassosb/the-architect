import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import Fastify from "fastify";
import {
  createArtifactQueue,
  createSession,
  enqueueArtifactGenerationJob,
  generateMistralAssistantResponse,
  getArtifactById,
  getSessionById,
  insertMessage,
  listArtifactsBySession,
  openDatabase,
  runMigrations,
  upsertJobStatus
} from "@the-architect/core";
import type { Mode } from "@the-architect/shared-types";
import {
  artifactDetailSchema,
  artifactIdParamsSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  healthResponseSchema,
  listArtifactsResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  sessionIdParamsSchema
} from "@the-architect/shared-types";

dotenv.config();

const env = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? "4000"),
  databaseUrl: process.env.DATABASE_URL ?? "./data/the-architect.sqlite",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  mistralModel: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
  mistralApiUrl:
    process.env.MISTRAL_API_URL ?? "https://api.mistral.ai/v1/chat/completions"
};

if (!Number.isFinite(env.port) || env.port <= 0) {
  throw new Error("PORT must be a positive number");
}

function isZodError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "ZodError"
  );
}

function mapModeToArtifactKind(mode: Mode) {
  if (mode === "planner") {
    return "tasks";
  }

  if (mode === "pitch") {
    return "pitch";
  }

  return "architecture";
}

function parseArtifactJson(content: string): unknown | null {
  if (!content.trim()) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const app = Fastify({ logger: true });
  const db = await openDatabase(env.databaseUrl);
  await runMigrations(db);

  const artifactQueue = createArtifactQueue(env.redisUrl);

  app.addHook("onClose", async () => {
    await Promise.allSettled([artifactQueue.close(), db.close()]);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isZodError(error)) {
      return reply.status(400).send({ error: "Invalid request payload" });
    }

    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async (_request, reply) => {
    const payload = healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    });

    return reply.status(200).send(payload);
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = createSessionRequestSchema.parse(request.body);

    const sessionInput = {
      id: randomUUID(),
      mode: body.mode,
      ...(body.title ? { title: body.title } : {})
    };

    const session = await createSession(db, sessionInput);

    const payload = createSessionResponseSchema.parse({
      id: session.id,
      mode: session.mode
    });

    return reply.status(201).send(payload);
  });

  app.post("/api/sessions/:id/messages", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const body = sendMessageRequestSchema.parse(request.body);

    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (!env.mistralApiKey) {
      return reply.status(500).send({
        error: "MISTRAL_API_KEY is not configured"
      });
    }

    await insertMessage(db, {
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      content: body.content,
      transcript_source: body.source
    });

    const assistant = await generateMistralAssistantResponse({
      apiKey: env.mistralApiKey,
      model: env.mistralModel,
      mode: session.mode,
      userInput: body.content,
      apiUrl: env.mistralApiUrl
    });

    await insertMessage(db, {
      id: randomUUID(),
      session_id: session.id,
      role: "assistant",
      content: JSON.stringify(assistant),
      transcript_source: "text"
    });

    const artifactKind = mapModeToArtifactKind(session.mode);

    const job = await enqueueArtifactGenerationJob(artifactQueue, {
      session: {
        id: session.id,
        mode: session.mode,
        ...(session.title ? { title: session.title } : {})
      },
      context: {
        user_input: body.content,
        assistant,
        artifact_kinds: [artifactKind],
        metadata: {
          source: body.source
        }
      }
    });

    const queueJobId = String(job.id ?? randomUUID());

    await upsertJobStatus(db, {
      id: queueJobId,
      session_id: session.id,
      kind: "artifact_generation",
      status: "pending"
    });

    const payload = sendMessageResponseSchema.parse({
      assistant,
      queued_jobs: [
        {
          id: queueJobId,
          kind: "artifact_generation"
        }
      ]
    });

    return reply.status(200).send(payload);
  });

  app.get("/api/sessions/:id/artifacts", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const artifacts = await listArtifactsBySession(db, params.id);
    const payload = listArtifactsResponseSchema.parse(
      artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title
      }))
    );

    return reply.status(200).send(payload);
  });

  app.get("/api/artifacts/:id", async (request, reply) => {
    const params = artifactIdParamsSchema.parse(request.params);
    const artifact = await getArtifactById(db, params.id);

    if (!artifact) {
      return reply.status(404).send({ error: "Artifact not found" });
    }

    const payload = artifactDetailSchema.parse({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      content_md: artifact.content_md,
      content_json: parseArtifactJson(artifact.content_json)
    });

    return reply.status(200).send(payload);
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({
    host: env.host,
    port: env.port
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
