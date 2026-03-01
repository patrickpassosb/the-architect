/**
 * @fileoverview Main API Server for 'The Architect'.
 *
 * Problem: We need a central hub that the Web UI can talk to.
 * This hub needs to handle user sessions, save messages,
 * talk to the AI (Mistral), and start background jobs.
 *
 * Solution: A Fastify-based HTTP server. Fastify is chosen for its
 * speed and excellent TypeScript support. It coordinates between
 * the Database, the AI, and the Task Queue.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
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
import * as sharedTypes from "../../../packages/shared-types/dist/index.js";
import type { AssistantResponse, Mode } from "../../../packages/shared-types/dist/index.js";

// Import Zod schemas for request and response validation
const {
  artifactDetailSchema,
  artifactIdParamsSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  healthResponseSchema,
  listArtifactsResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  sessionIdParamsSchema
} = sharedTypes;

/**
 * Problem: During development, we need to find the root of the project
 * to load the correct .env files and find the database.
 * Solution: Recursively look up the directory tree until we find
 * a package.json with a 'workspaces' field.
 */
function findRepoRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          workspaces?: unknown;
        };

        if (Array.isArray(packageJson.workspaces)) {
          return currentDir;
        }
      } catch {
        // Ignore malformed package.json and continue searching upwards.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}

/**
 * Problem: API keys and database URLs shouldn't be hardcoded.
 * Solution: Load environment variables from .env and .env.local files
 * using 'dotenv'.
 */
function loadEnvironment() {
  const repoRoot = findRepoRoot(process.cwd());

  dotenv.config({ path: path.join(repoRoot, ".env") });
  dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (
    databaseUrl &&
    databaseUrl !== ":memory:" &&
    !databaseUrl.startsWith("sqlite://") &&
    !databaseUrl.startsWith("file:") &&
    !path.isAbsolute(databaseUrl)
  ) {
    process.env.DATABASE_URL = path.resolve(repoRoot, databaseUrl);
  }
}

// Initialize environment before starting the server
loadEnvironment();

/**
 * Central Configuration object
 */
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

// basic safety check
if (!Number.isFinite(env.port) || env.port <= 0) {
  throw new Error("PORT must be a positive number");
}

/**
 * Helper: Check if an error came from Zod validation.
 */
function isZodError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "ZodError"
  );
}

/**
 * Problem: The UI uses 'mode' names like 'planner', but our documents (artifacts)
 * use kinds like 'tasks'.
 * Solution: A simple mapping function.
 */
function mapModeToArtifactKind(mode: Mode) {
  if (mode === "planner") {
    return "tasks";
  }

  if (mode === "pitch") {
    return "pitch";
  }

  return "architecture";
}

/**
 * Helper: Safely parse a JSON string, returning null if it's invalid.
 */
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

/**
 * Problem: If the Mistral AI API is down, the whole app shouldn't crash.
 * Solution: Return a "fallback" response that explains the situation
 * to the user nicely.
 */
function buildFallbackAssistantResponse(error: unknown): AssistantResponse {
  const detail = error instanceof Error ? error.message : "Unknown provider error";
  return {
    summary: `Assistant provider is currently unavailable: ${detail.slice(0, 180)}`,
    decision: "Continue with a local fallback response and retry provider integration shortly.",
    next_actions: [
      "Retry the same request in a few moments.",
      "Verify MISTRAL_API_KEY and outbound network connectivity from the API process.",
      "Use text mode to continue planning while provider connectivity is restored."
    ]
  };
}

/**
 * Helper: Wraps a Promise with a timeout.
 * If the operation takes too long, it rejects.
 */
async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Helper: Identify if an error is related to Redis connection issues.
 */
function isRedisConnectivityError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("redis")
  );
}

/**
 * Main Server Startup Function
 */
async function start(): Promise<void> {
  // Create Fastify instance with logging enabled
  const app = Fastify({ logger: true });

  // 1. Connect to Database and run migrations
  const db = await openDatabase(env.databaseUrl);
  await runMigrations(db);

  // 2. Enable CORS so the Next.js frontend (on port 3000) can talk to this API (on port 4000)
  await app.register(cors, {
    origin: true
  });

  // 3. Connect to the background task queue
  const artifactQueue = createArtifactQueue(env.redisUrl);

  // 4. Graceful Shutdown: Close connections when the server stops
  app.addHook("onClose", async () => {
    await Promise.allSettled([artifactQueue.close(), db.close()]);
  });

  /**
   * Global Error Handler
   * Problem: We want to return consistent JSON error messages to the frontend.
   * Solution: Catch errors and map them to HTTP status codes (400, 502, 503, etc.).
   */
  app.setErrorHandler((error, _request, reply) => {
    // Handle Zod validation errors (e.g., missing required fields in POST body)
    if (isZodError(error)) {
      return reply.status(400).send({ error: "Invalid request payload" });
    }

    // Handle other Fastify errors with status codes
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number" &&
      (error as { statusCode: number }).statusCode >= 400 &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      const statusCode = (error as { statusCode: number }).statusCode;
      const message =
        "message" in error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Request error";

      return reply.status(statusCode).send({ error: message });
    }

    // Handle specific backend errors (AI down, Redis down)
    if (error instanceof Error) {
      if (error.message.startsWith("Mistral API 401")) {
        return reply
          .status(502)
          .send({ error: "Mistral authentication failed. Check MISTRAL_API_KEY." });
      }

      if (error.message.startsWith("Mistral API")) {
        return reply.status(502).send({ error: error.message });
      }

      if (isRedisConnectivityError(error)) {
        return reply.status(503).send({ error: "Redis is unavailable. Start Redis and try again." });
      }
    }

    // Fallback for unexpected errors
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });

  /**
   * Route: Health Check
   * Used by Docker or monitoring tools to see if the API is alive.
   */
  app.get("/api/health", async (_request, reply) => {
    const payload = healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    });

    return reply.status(200).send(payload);
  });

  /**
   * Route: Create Session
   * Starts a new conversation with 'The Architect'.
   */
  app.post("/api/sessions", async (request, reply) => {
    // Validate the request body
    const body = createSessionRequestSchema.parse(request.body);

    const sessionInput = {
      id: randomUUID(),
      mode: body.mode,
      ...(body.title ? { title: body.title } : {})
    };

    // Save to database
    const session = await createSession(db, sessionInput);

    // Validate the response
    const payload = createSessionResponseSchema.parse({
      id: session.id,
      mode: session.mode
    });

    return reply.status(201).send(payload);
  });

  /**
   * Route: Send Message
   * This is the "Heart" of the app. It handles the AI interaction.
   *
   * Flow:
   * 1. Save the user's message to the DB.
   * 2. Call Mistral AI to get a technical recommendation.
   * 3. Save the AI's response to the DB.
   * 4. Enqueue a background job to generate a full document (artifact).
   */
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

    // 1. Save User Message
    await insertMessage(db, {
      id: randomUUID(),
      session_id: session.id,
      role: "user",
      content: body.content,
      transcript_source: body.source
    });

    let assistantTimeout: NodeJS.Timeout | null = null;

    // 2. Call AI (Mistral)
    // We use Promise.race to ensure we don't wait forever for the AI.
    const assistant = await Promise.race([
      generateMistralAssistantResponse({
        apiKey: env.mistralApiKey,
        model: env.mistralModel,
        mode: session.mode,
        userInput: body.content,
        apiUrl: env.mistralApiUrl
      }),
      new Promise<AssistantResponse>((resolve) => {
        assistantTimeout = setTimeout(() => {
          app.log.warn(
            { sessionId: session.id },
            "Mistral request exceeded route timeout; returning fallback response"
          );
          resolve(
            buildFallbackAssistantResponse(
              new Error("Mistral request timed out while generating assistant response")
            )
          );
        }, 15_000); // 15 second timeout for AI response
      })
    ]).catch((error) => buildFallbackAssistantResponse(error));

    if (assistantTimeout) {
      clearTimeout(assistantTimeout);
    }

    // 3. Save AI Response
    await insertMessage(db, {
      id: randomUUID(),
      session_id: session.id,
      role: "assistant",
      content: JSON.stringify(assistant),
      transcript_source: "text"
    });

    // 4. Enqueue Artifact Generation
    const artifactKind = mapModeToArtifactKind(session.mode);
    let queuedJobs: Array<{ id: string; kind: "artifact_generation" }> = [];

    try {
      const job = await withTimeout(
        enqueueArtifactGenerationJob(artifactQueue, {
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
        }),
        2_000,
        "Redis enqueue timed out"
      );

      const queueJobId = String(job.id ?? randomUUID());

      // Track the job status in our database so the frontend can poll for it
      await upsertJobStatus(db, {
        id: queueJobId,
        session_id: session.id,
        kind: "artifact_generation",
        status: "pending"
      });

      queuedJobs = [{ id: queueJobId, kind: "artifact_generation" }];
    } catch (error) {
      app.log.error(
        {
          error,
          sessionId: session.id
        },
        "Failed to enqueue artifact generation job"
      );
    }

    const payload = sendMessageResponseSchema.parse({
      assistant,
      queued_jobs: queuedJobs
    });

    return reply.status(200).send(payload);
  });

  /**
   * Route: List Artifacts
   * Gets all documents generated for a specific session.
   */
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

  /**
   * Route: Get Artifact Detail
   * Gets the full content (Markdown + JSON) of a specific document.
   */
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

  /**
   * Graceful Shutdown handlers
   */
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

  // Start listening for requests!
  await app.listen({
    host: env.host,
    port: env.port
  });
}

// Kick off the server!
start().catch((error) => {
  console.error(error);
  process.exit(1);
});
