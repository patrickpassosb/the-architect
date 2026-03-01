import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Redis from "ioredis";
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

const {
  artifactDetailSchema,
  artifactIdParamsSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  generateArchitectureRequestSchema,
  generateArchitectureResponseSchema,
  healthResponseSchema,
  listArtifactsResponseSchema,
  runBuildRequestSchema,
  runBuildResponseSchema,
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  synthesizeVoiceRequestSchema,
  synthesizeVoiceResponseSchema,
  sessionIdParamsSchema
} = sharedTypes;

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

loadEnvironment();

const env = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? "4000"),
  databaseUrl: process.env.DATABASE_URL ?? "./data/the-architect.sqlite",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  mistralApiKey: process.env.MISTRAL_API_KEY ?? "",
  mistralModel: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
  mistralApiUrl:
    process.env.MISTRAL_API_URL ?? "https://api.mistral.ai/v1/chat/completions",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2"
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

function isRedisConnectivityError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("redis")
  );
}

type CommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
};

async function runCommand(
  binary: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 2_000).unref();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      const joined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
      const maxLength = 30_000;
      const output = joined.length > maxLength ? joined.slice(-maxLength) : joined;
      resolve({
        exitCode,
        timedOut,
        output
      });
    });
  });
}

function buildVibePrompt(input: {
  sessionId: string;
  mode: Mode;
  goal?: string;
  context?: string;
}): string {
  const goal =
    input.goal?.trim() ||
    "Create or improve this project implementation based on the current architecture decisions.";

  return [
    "You are helping implement a hackathon MVP in this repository.",
    `Session ID: ${input.sessionId}`,
    `Mode: ${input.mode}`,
    `Goal: ${goal}`,
    input.context?.trim() ? `Context:\n${input.context.trim()}` : "",
    "Constraints:",
    "- Work only inside this repository.",
    "- Keep changes minimal and focused on demo reliability.",
    "- Prefer code that is easy to demo in under 2 minutes.",
    "- End with a short summary of files changed and commands to run."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseAssistantContent(raw: string): AssistantResponse | null {
  try {
    const value = JSON.parse(raw);
    return sharedTypes.assistantResponseSchema.parse(value);
  } catch {
    return null;
  }
}

type StoredMessageRow = {
  role: "user" | "assistant" | "system";
  content: string;
  transcript_source: "voice" | "text";
  created_at: string;
};

function summarizeMessageForContext(row: StoredMessageRow): string {
  if (row.role === "assistant") {
    const parsed = parseAssistantContent(row.content);
    if (parsed) {
      const next = parsed.next_actions.slice(0, 3).join("; ");
      return `assistant: ${parsed.summary} | decision=${parsed.decision} | next=${next}`;
    }
  }

  const compact = row.content.replace(/\s+/g, " ").trim();
  return `${row.role}: ${compact.slice(0, 260)}`;
}

async function buildChatContext(db: Awaited<ReturnType<typeof openDatabase>>, sessionId: string): Promise<string> {
  const recent = await db.all<StoredMessageRow[]>(
    `SELECT role, content, transcript_source, created_at
     FROM messages
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT 12`,
    sessionId
  );

  const ordered = recent.reverse();
  const lines = ordered.map((row) => summarizeMessageForContext(row));
  const joined = lines.join("\n");
  return joined.length > 6_000 ? joined.slice(joined.length - 6_000) : joined;
}

async function start(): Promise<void> {
  const app = Fastify({ logger: true });
  const db = await openDatabase(env.databaseUrl);
  await runMigrations(db);

  await app.register(cors, {
    origin: true
  });

  await app.register(FastifySSEPlugin);

  const artifactQueue = createArtifactQueue(env.redisUrl);

  const redisSubscriber = new Redis(env.redisUrl);
  redisSubscriber.setMaxListeners(0); // Prevent warnings for many connected clients

  app.addHook("onClose", async () => {
    await Promise.allSettled([artifactQueue.close(), db.close(), redisSubscriber.quit()]);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isZodError(error)) {
      return reply.status(400).send({ error: "Invalid request payload" });
    }

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

  app.get("/api/sessions/:id/events", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const channel = `session:${session.id}`;

    const listener = (chn: string, message: string) => {
      if (chn === channel) {
        reply.sse({ data: message });
      }
    };

    redisSubscriber.on("message", listener);
    // Ensure we are subscribed to the channel. 
    // It's safe to call subscribe multiple times for the same channel.
    await redisSubscriber.subscribe(channel);

    request.raw.on("close", () => {
      redisSubscriber.removeListener("message", listener);
      // We don't unsubscribe here because other clients might be listening to the same session.
      // In a more complex setup, we'd refcount subscriptions.
    });

    // Send initial "connected" event
    reply.sse({ event: "connected", data: JSON.stringify({ connected: true }) });
  });

  app.post("/api/voice/synthesize", async (request, reply) => {
    const body = synthesizeVoiceRequestSchema.parse(request.body);

    if (!env.elevenLabsApiKey) {
      return reply.status(500).send({
        error: "ELEVENLABS_API_KEY is not configured"
      });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenLabsVoiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.elevenLabsApiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text: body.text,
          model_id: env.elevenLabsModelId,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return reply.status(502).send({
        error: `ElevenLabs API ${response.status}: ${errorBody.slice(0, 300)}`
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const payload = synthesizeVoiceResponseSchema.parse({
      provider: "elevenlabs",
      content_type: response.headers.get("content-type") ?? "audio/mpeg",
      audio_base64: buffer.toString("base64")
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

    let assistantTimeout: NodeJS.Timeout | null = null;

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
        }, 15_000);
      })
    ]).catch((error) => buildFallbackAssistantResponse(error));

    if (assistantTimeout) {
      clearTimeout(assistantTimeout);
    }

    await insertMessage(db, {
      id: randomUUID(),
      session_id: session.id,
      role: "assistant",
      content: JSON.stringify(assistant),
      transcript_source: "text"
    });

    const artifactKind = mapModeToArtifactKind(session.mode);
    const chatContext = await buildChatContext(db, session.id);

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
              source: body.source,
              chat_context: chatContext
            }
          }
        }),
        2_000,
        "Redis enqueue timed out"
      );

      const queueJobId = String(job.id ?? randomUUID());

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

  app.post("/api/sessions/:id/architecture", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const body = generateArchitectureRequestSchema.parse(request.body ?? {});
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const latestUser = await db.get<{ content: string }>(
      `SELECT content
       FROM messages
       WHERE session_id = ? AND role = 'user'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    if (!latestUser?.content) {
      return reply.status(400).send({
        error: "No user context found for this session. Send a message first."
      });
    }

    const latestAssistantRow = await db.get<{ content: string }>(
      `SELECT content
       FROM messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    let assistant = latestAssistantRow ? parseAssistantContent(latestAssistantRow.content) : null;
    let source: "latest_assistant" | "generated_assistant" = "latest_assistant";

    if (!assistant) {
      if (!env.mistralApiKey) {
        return reply.status(500).send({
          error: "MISTRAL_API_KEY is not configured and no prior assistant context exists"
        });
      }

      const generated = await generateMistralAssistantResponse({
        apiKey: env.mistralApiKey,
        model: env.mistralModel,
        mode: "architect",
        userInput: [
          latestUser.content,
          body.focus ? `Architecture focus: ${body.focus}` : ""
        ]
          .filter(Boolean)
          .join("\n\n"),
        apiUrl: env.mistralApiUrl
      });

      assistant = generated;
      source = "generated_assistant";
    }

    const chatContext = await buildChatContext(db, session.id);

    const job = await withTimeout(
      enqueueArtifactGenerationJob(artifactQueue, {
        session: {
          id: session.id,
          mode: "architect",
          ...(session.title ? { title: session.title } : {})
        },
        context: {
          user_input: latestUser.content,
          assistant,
          artifact_kinds: ["architecture"],
          metadata: {
            source: "system",
            trigger: "manual_architecture_generation",
            focus: body.focus ?? "",
            chat_context: chatContext
          }
        }
      }),
      2_000,
      "Redis enqueue timed out"
    );

    const queueJobId = String(job.id ?? randomUUID());

    await upsertJobStatus(db, {
      id: queueJobId,
      session_id: session.id,
      kind: "artifact_generation",
      status: "pending"
    });

    const payload = generateArchitectureResponseSchema.parse({
      queued_job: { id: queueJobId, kind: "artifact_generation" },
      source
    });

    return reply.status(202).send(payload);
  });

  app.post("/api/sessions/:id/build", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const body = runBuildRequestSchema.parse(request.body ?? {});
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const latestAssistant = await db.get<{ content: string }>(
      `SELECT content
       FROM messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    const latestArchitecture = await db.get<{ content_md: string }>(
      `SELECT content_md
       FROM artifacts
       WHERE session_id = ? AND kind = 'architecture'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    const parsedAssistant = latestAssistant ? parseAssistantContent(latestAssistant.content) : null;
    const contextParts = [
      body.context?.trim() ?? "",
      parsedAssistant
        ? `Latest assistant response:\nSummary: ${parsedAssistant.summary}\nDecision: ${parsedAssistant.decision}\nNext actions: ${parsedAssistant.next_actions.join("; ")}`
        : "",
      latestArchitecture?.content_md
        ? `Latest architecture artifact:\n${latestArchitecture.content_md.slice(0, 6_000)}`
        : ""
    ].filter(Boolean);

    const prompt = buildVibePrompt({
      sessionId: session.id,
      mode: session.mode,
      goal: body.goal,
      context: contextParts.join("\n\n")
    });

    const repoRoot = findRepoRoot(process.cwd());
    const commandArgs = ["--workdir", repoRoot, "-p", prompt, "--max-turns", body.dry_run ? "4" : "10", "--output", "text"];
    if (body.dry_run) {
      commandArgs.push("--agent", "plan");
    }

    const startedAt = Date.now();

    let commandResult: CommandResult;
    try {
      commandResult = await runCommand("vibe", commandArgs, {
        cwd: repoRoot,
        timeoutMs: body.dry_run ? 45_000 : 120_000
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Vibe execution error";
      const looksLikeMissingBinary =
        message.toLowerCase().includes("enoent") || message.toLowerCase().includes("not found");
      return reply.status(looksLikeMissingBinary ? 501 : 500).send({
        error: looksLikeMissingBinary
          ? "Vibe CLI is not available on this host. Install `vibe` to enable build automation."
          : message
      });
    }

    const duration = Date.now() - startedAt;
    const status = commandResult.timedOut
      ? "timed_out"
      : commandResult.exitCode === 0
        ? "completed"
        : "failed";

    const payload = runBuildResponseSchema.parse({
      build_id: randomUUID(),
      status,
      command: `vibe --workdir ${repoRoot} -p <prompt> --max-turns ${body.dry_run ? "4" : "10"} --output text${body.dry_run ? " --agent plan" : ""}`,
      exit_code: commandResult.exitCode,
      output: commandResult.output,
      duration_ms: duration,
      notes: [
        commandResult.timedOut ? "Execution timed out before completion." : "Execution completed.",
        "Output may be truncated to keep response size bounded."
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
