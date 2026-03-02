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
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { FastifySSEPlugin } from "fastify-sse-v2";
import Redis from "ioredis";
import {
  createArtifactQueue,
  createSession,
  decomposeGoalIntoSubtasks,
  enqueueArtifactGenerationJob,
  generateMistralAssistantResponse,
  generateMistralTechStackProposal,
  generateArchitectureBlueprint,
  generateDesignSummary,
  getArtifactById,
  getSessionById,
  insertMessage,
  listArtifactsBySession,
  openDatabase,
  runMigrations,
  upsertJobStatus,
  saveNodePositions,
  getSavedNodePositions,
  insertDesignSummary,
  getLatestDesignSummary,
  getSessionMessageCount,
  getAllMessages,
  insertArtifact,
  runVibeInSandbox,
  updateSessionTechStack,
  transcribeMistralAudio
} from "@the-architect/core";
import * as sharedTypes from "@the-architect/shared-types";
import type { AssistantResponse, Mode } from "@the-architect/shared-types";

// Import Zod schemas for request and response validation
const {
  artifactDetailSchema,
  artifactIdParamsSchema,
  buildSubTaskResultSchema,
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
  transcribeVoiceResponseSchema,
  sessionIdParamsSchema,
  saveLayoutRequestSchema,
  saveLayoutResponseSchema,
  getBlueprintResponseSchema,
  updateTechStackRequestSchema,
  updateTechStackResponseSchema,
  getTechStackResponseSchema,
  proposeTechStackResponseSchema
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
const repoRoot = findRepoRoot(process.cwd());
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
  elevenLabsVoiceModelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
  sandboxImage: process.env.SANDBOX_DOCKER_IMAGE ?? "architect-vibe-image",
  sandboxMemoryLimit: process.env.SANDBOX_MEMORY_LIMIT ?? "2g",
  sandboxCpuLimit: parseFloat(process.env.SANDBOX_CPU_LIMIT ?? "1.0"),
  projectsRoot: process.env.PROJECTS_ROOT ?? path.join(repoRoot, "projects")
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
 * Helper: Retry an operation with exponential backoff.
 * Returns the result on success or throws on final failure.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  baseDelayMs: number = 500
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
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
type CommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
};

type StreamingConfig = {
  publisher: Redis;
  channel: string;
  agentLabel: string;
};

async function runCommand(
  binary: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; streaming?: StreamingConfig }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const publishLine = (line: string) => {
      if (options.streaming && line.trim()) {
        let displayData = line;
        try {
          // Attempt to extract meaningful content from vibe streaming JSON
          const parsed = JSON.parse(line);
          if (parsed.content) {
            displayData = parsed.content;
          } else if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            displayData = `[Tool] ${parsed.tool_calls.map((tc: any) => tc.function?.name || "unnamed").join(", ")}`;
          } else if (parsed.role === "user") {
            // Echoing the goal is redundant
            return;
          } else if (parsed.role === "assistant" && !parsed.content && !parsed.tool_calls) {
            // Empty assistant message (e.g. reasoning only) - skip
            return;
          }
        } catch {
          // raw line
        }

        const message = JSON.stringify({
          type: "build_log",
          agent: options.streaming.agentLabel,
          data: displayData
        });
        options.streaming.publisher.publish(options.streaming.channel, message).catch(() => { });
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        publishLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        publishLine(line);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      // Flush remaining buffer
      if (stdoutBuffer.trim()) publishLine(stdoutBuffer);
      if (stderrBuffer.trim()) publishLine(stderrBuffer);
      // Publish build completion event
      if (options.streaming) {
        const doneMessage = JSON.stringify({
          type: "build_done",
          agent: options.streaming.agentLabel,
          exit_code: exitCode,
          timed_out: timedOut
        });
        options.streaming.publisher.publish(options.streaming.channel, doneMessage).catch(() => { });
      }
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
    "CRITICAL SECURITY CONSTRAINTS:",
    "- STAY WITHIN THE REPOSITORY: Do NOT write files, create directories, or run any commands that affect paths outside of the current working directory.",
    "- NO DESTRUCTIVE ACTIONS: Do NOT run 'rm', 'mv', or other destructive commands on any path outside of the project sub-directories.",
    "- ENVIRONMENT: You are running in an automated environment (auto-approve). Any hallucination that affects the user's system outside this repo is a critical failure.",
    "",
    "Rules:",
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
  const session = await getSessionById(db, sessionId);
  let techStackContext = "";
  if (session?.tech_stack) {
    techStackContext = `[CONFIRMED TECH STACK]\n${session.tech_stack}\n\n`;
  }

  // Full history: Fetch ALL messages for the session
  const allMessages = await getAllMessages(db, sessionId);
  const lines = allMessages.map((row) => summarizeMessageForContext(row as StoredMessageRow));
  const joined = techStackContext + lines.join("\n");
  // If context is very large, use latest design summary + recent messages
  if (joined.length > 12_000) {
    const summary = await getLatestDesignSummary(db, sessionId);
    if (summary) {
      const recentLines = lines.slice(-10);
      return `${techStackContext}[Design Summary]\n${summary.summary}\n\n[Recent Messages]\n${recentLines.join("\n")}`;
    }
    // Fallback: take the last 12k characters
    return joined.slice(joined.length - 12_000);
  }
  return joined;
}

/**
 * Incremental Summarizer: Generate a design summary every 10 messages.
 * Runs in the background (fire-and-forget) to avoid blocking the response.
 */
async function maybeGenerateDesignSummary(
  db: Awaited<ReturnType<typeof openDatabase>>,
  sessionId: string
): Promise<void> {
  if (!env.mistralApiKey) return;

  try {
    const messageCount = await getSessionMessageCount(db, sessionId);
    const latestSummary = await getLatestDesignSummary(db, sessionId);
    const lastSummarizedAt = latestSummary?.message_count ?? 0;

    // Generate summary every 10 messages
    if (messageCount - lastSummarizedAt < 10) return;

    const allMessages = await getAllMessages(db, sessionId);
    const chatText = allMessages
      .map((m) => `${m.role}: ${m.content.replace(/\s+/g, " ").trim().slice(0, 300)}`)
      .join("\n");

    const summaryText = await generateDesignSummary({
      apiKey: env.mistralApiKey,
      model: env.mistralModel,
      chatHistory: chatText.slice(-8_000),
      previousSummary: latestSummary?.summary,
      apiUrl: env.mistralApiUrl
    });

    await insertDesignSummary(db, {
      session_id: sessionId,
      summary: summaryText,
      message_count: messageCount
    });
  } catch (error) {
    // Non-critical: log and continue
    console.error("Design summary generation failed:", error instanceof Error ? error.message : error);
  }
}

async function start(): Promise<void> {
  // Create Fastify instance with logging enabled
  const app = Fastify({ logger: true });

  // 1. Connect to Database and run migrations
  const db = await openDatabase(env.databaseUrl);
  await runMigrations(db);

  // 2. Enable CORS so the Next.js frontend (on port 3000) can talk to this API (on port 4000)
  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
  });

  // 3. Enable multipart form data parsing for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    }
  });

  // 4. Connect to the background task queue
  const artifactQueue = createArtifactQueue(env.redisUrl);

  // 4. Graceful Shutdown: Close connections when the server stops
  await app.register(FastifySSEPlugin);

  const redisSubscriber = new Redis(env.redisUrl);
  redisSubscriber.setMaxListeners(0); // Prevent warnings for many connected clients

  // Separate publisher for streaming build logs and events
  const redisPublisher = new Redis(env.redisUrl);

  app.addHook("onClose", async () => {
    await Promise.allSettled([artifactQueue.close(), db.close(), redisSubscriber.quit(), redisPublisher.quit()]);
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
          model_id: env.elevenLabsVoiceModelId,
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

  async function convertAudioToMp3(inputBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const inputPath = `/tmp/audio_input_${randomUUID()}.webm`;
      const outputPath = `/tmp/audio_output_${randomUUID()}.mp3`;

      fs.writeFileSync(inputPath, inputBuffer);

      const ffmpeg = spawn("ffmpeg", [
        "-i", inputPath,
        "-acodec", "libmp3lame",
        "-q:a", "2",
        "-y",
        outputPath
      ]);

      ffmpeg.on("close", (code) => {
        fs.unlinkSync(inputPath);
        if (code === 0) {
          const outputBuffer = fs.readFileSync(outputPath);
          fs.unlinkSync(outputPath);
          resolve(outputBuffer);
        } else {
          fs.unlinkSync(outputPath);
          reject(new Error(`ffmpeg conversion failed with code ${code}`));
        }
      });

      ffmpeg.on("error", (err) => {
        fs.unlinkSync(inputPath);
        reject(err);
      });
    });
  }

  app.post("/api/voice/transcribe", async (request, reply) => {
    if (!env.mistralApiKey) {
      return reply.status(500).send({ error: "MISTRAL_API_KEY is not configured" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No audio file uploaded" });
    }

    const audioBuffer = await data.toBuffer();

    try {
      const mp3Buffer = await convertAudioToMp3(audioBuffer);

      const text = await transcribeMistralAudio({
        apiKey: env.mistralApiKey,
        audioBuffer: mp3Buffer,
        fileName: "recording.mp3",
        mimeType: "audio/mpeg",
        model: "voxtral-mini-latest",
        apiUrl: "https://api.mistral.ai/v1/audio/transcriptions"
      });

      const payload = transcribeVoiceResponseSchema.parse({ text });
      return reply.status(200).send(payload);
    } catch (error) {
      app.log.error({ error }, "Mistral transcription failed");
      const message = error instanceof Error ? error.message : "Transcription failed";
      return reply.status(502).send({ error: message });
    }
  });

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

  app.get("/api/sessions/:id/tech-stack", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const techStack = session.tech_stack ? JSON.parse(session.tech_stack) : null;
    const payload = getTechStackResponseSchema.parse({ tech_stack: techStack });
    return reply.status(200).send(payload);
  });

  app.patch("/api/sessions/:id/tech-stack", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const body = updateTechStackRequestSchema.parse(request.body);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    await updateSessionTechStack(db, session.id, JSON.stringify(body.tech_stack));

    const payload = updateTechStackResponseSchema.parse({ success: true });
    return reply.status(200).send(payload);
  });

  app.post("/api/sessions/:id/tech-stack/propose", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (!env.mistralApiKey) {
      return reply.status(500).send({ error: "MISTRAL_API_KEY not configured" });
    }

    const chatContext = await buildChatContext(db, session.id);

    try {
      const proposals = await generateMistralTechStackProposal({
        apiKey: env.mistralApiKey,
        model: env.mistralModel,
        chatHistory: chatContext,
        apiUrl: env.mistralApiUrl
      });

      const payload = proposeTechStackResponseSchema.parse({ proposals });
      return reply.status(200).send(payload);
    } catch (error) {
      app.log.error({ error }, "Failed to generate tech stack proposal");
      const message = error instanceof Error ? error.message : "Proposal generation failed";
      return reply.status(502).send({ error: message });
    }
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

    // 2. Call AI (Mistral) with retry logic
    const callMistral = () => generateMistralAssistantResponse({
      apiKey: env.mistralApiKey,
      model: env.mistralModel,
      mode: session.mode,
      userInput: body.content,
      apiUrl: env.mistralApiUrl,
      timeoutMs: 60_000
    });

    // We use Promise.race to ensure we don't wait forever for the AI.
    const assistant = await Promise.race([
      withRetry(callMistral, 2, 500).catch(error => {
        app.log.warn({ error, sessionId: session.id }, "Mistral failed after retries");
        return buildFallbackAssistantResponse(error);
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
        }, 60_000); // 60 seconds timeout for AI response (faster fallback)
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

    // Fire-and-forget: Check if we need to generate a design summary
    void maybeGenerateDesignSummary(db, session.id);

    return reply.status(200).send(payload);
  });

  /**
   * Route: List Artifacts
   * Gets all documents generated for a specific session.
   */
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

    const channel = `session:${session.id}`;

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

    // Fetch the latest blueprint JSON for the build context
    const latestBlueprintArtifact = await db.get<{ content_json: string }>(
      `SELECT content_json
       FROM artifacts
       WHERE session_id = ? AND kind = 'architecture'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    let blueprintContext = "";
    if (latestBlueprintArtifact?.content_json) {
      const blueprintData = parseArtifactJson(latestBlueprintArtifact.content_json);
      if (blueprintData && typeof blueprintData === "object" && "blueprint_json" in (blueprintData as Record<string, unknown>)) {
        blueprintContext = `Current React Flow Blueprint (use this as the architecture reference):\n${JSON.stringify((blueprintData as Record<string, unknown>).blueprint_json, null, 2).slice(0, 4_000)}`;
      }
    }

    const contextParts = [
      blueprintContext,
      latestArchitecture?.content_md
        ? `Latest architecture artifact:\n${latestArchitecture.content_md.slice(0, 6_000)}`
        : "",
      parsedAssistant
        ? `Latest assistant response:\nSummary: ${parsedAssistant.summary}\nDecision: ${parsedAssistant.decision}\nNext actions: ${parsedAssistant.next_actions.join("; ")}`
        : "",
      body.context?.trim() ?? ""
    ].filter(Boolean);

    const repoRoot = findRepoRoot(process.cwd());
    const projectsRoot = path.join(repoRoot, "projects");
    if (!fs.existsSync(projectsRoot)) {
      fs.mkdirSync(projectsRoot, { recursive: true });
    }

    const sessionProjectDir = path.join(projectsRoot, session.id);
    if (!fs.existsSync(sessionProjectDir)) {
      fs.mkdirSync(sessionProjectDir, { recursive: true });
    }

    const startedAt = Date.now();

    // Publish build_start event
    const buildStartMsg = JSON.stringify({ type: "build_start", turbo: body.turbo });
    await redisPublisher.publish(channel, buildStartMsg).catch(() => { });

    // --- TURBO MODE ---
    if (body.turbo && env.mistralApiKey) {
      const goal = body.goal?.trim() || "Implement the current architecture plan.";

      let subTasks: string[];
      try {
        subTasks = await decomposeGoalIntoSubtasks({
          apiKey: env.mistralApiKey,
          model: env.mistralModel,
          goal,
          blueprintContext: blueprintContext || undefined,
          architectureContext: latestArchitecture?.content_md?.slice(0, 3_000),
          apiUrl: env.mistralApiUrl
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Task decomposition failed";
        return reply.status(502).send({ error: `Turbo decomposition failed: ${message}` });
      }

      // Publish decomposition result
      const decomposeMsg = JSON.stringify({
        type: "build_log",
        agent: "Orchestrator",
        data: `🚀 Turbo mode: decomposed into ${subTasks.length} parallel agents: ${subTasks.map((t, i) => `[Agent ${i + 1}] ${t.slice(0, 60)}`).join(", ")}`
      });
      await redisPublisher.publish(channel, decomposeMsg).catch(() => { });

      // Run all sub-tasks in parallel
      const subTaskPromises = subTasks.map((task, index) => {
        const agentLabel = `Agent ${index + 1}`;
        const subPrompt = buildVibePrompt({
          sessionId: session.id,
          mode: session.mode,
          goal: task,
          context: contextParts.join("\n\n")
        });

        const subStartedAt = Date.now();
        return runVibeInSandbox(
          session.id,
          subPrompt,
          {
            image: env.sandboxImage,
            memoryLimit: env.sandboxMemoryLimit,
            cpuLimit: env.sandboxCpuLimit,
            workdir: sessionProjectDir
          },
          {
            maxTurns: body.dry_run ? 4 : 15,
            dryRun: body.dry_run ?? false,
            timeoutMs: body.dry_run ? 60_000 : 300_000,
            streaming: { publisher: redisPublisher, channel, agentLabel }
          }
        ).then((result) => ({
          agent: agentLabel,
          task,
          status: (result.timedOut ? "timed_out" : result.exitCode === 0 ? "completed" : "failed") as "completed" | "failed" | "timed_out",
          exit_code: result.exitCode,
          output: result.output,
          duration_ms: Date.now() - subStartedAt
        })).catch((error) => {
          const err = error as Error & { hint?: string };
          let output = err.message || "Unknown error";
          if (err.hint) {
            output += `\n\n💡 ${err.hint}`;
          }
          return {
            agent: agentLabel,
            task,
            status: "failed" as const,
            exit_code: null,
            output,
            duration_ms: Date.now() - subStartedAt
          };
        });
      });

      const subResults = await Promise.all(subTaskPromises);
      const duration = Date.now() - startedAt;

      const allCompleted = subResults.every((r) => r.status === "completed");
      const anyTimedOut = subResults.some((r) => r.status === "timed_out");
      const overallStatus = anyTimedOut ? "timed_out" : allCompleted ? "completed" : "failed";

      const combinedOutput = subResults
        .map((r) => `=== [${r.agent}] ${r.task} (${r.status}) ===\n${r.output}`)
        .join("\n\n");

      const payload = runBuildResponseSchema.parse({
        build_id: randomUUID(),
        status: overallStatus,
        command: `turbo: ${subTasks.length} parallel vibe agents`,
        exit_code: allCompleted ? 0 : 1,
        output: combinedOutput.length > 30_000 ? combinedOutput.slice(-30_000) : combinedOutput,
        duration_ms: duration,
        turbo: true,
        sub_tasks: subResults,
        notes: [
          `Turbo mode: ${subTasks.length} agents ran in parallel.`,
          `Overall status: ${overallStatus}.`,
          ...subResults.map((r) => `[${r.agent}] ${r.status} in ${(r.duration_ms / 1000).toFixed(1)}s`)
        ]
      });

      return reply.status(200).send(payload);
    }

    // --- BUDGET MODE (default, with streaming) ---
    const prompt = buildVibePrompt({
      sessionId: session.id,
      mode: session.mode,
      goal: body.goal,
      context: contextParts.join("\n\n")
    });

    let commandResult: CommandResult;
    try {
      commandResult = await runVibeInSandbox(
        session.id,
        prompt,
        {
          image: env.sandboxImage,
          memoryLimit: env.sandboxMemoryLimit,
          cpuLimit: env.sandboxCpuLimit,
          workdir: sessionProjectDir
        },
        {
          maxTurns: body.dry_run ? 4 : 15,
          dryRun: body.dry_run ?? false,
          timeoutMs: body.dry_run ? 60_000 : 300_000,
          streaming: { publisher: redisPublisher, channel, agentLabel: "Vibe" }
        }
      );
    } catch (error) {
      const err = error as Error & { code?: string; hint?: string };
      const message = err.message || "Unknown Vibe execution error";
      const errorCode = err.code;
      const hint = err.hint;
      
      const statusCode = errorCode === "docker_not_found" || errorCode === "image_not_found" ? 501 : 500;
      
      let userMessage = message;
      if (hint) {
        userMessage = `${message}\n\n💡 ${hint}`;
      }
      
      return reply.status(statusCode).send({
        error: userMessage,
        code: errorCode
      });
    }

    const duration = Date.now() - startedAt;
    const status = commandResult.timedOut
      ? "timed_out"
      : commandResult.exitCode === 0
        ? "completed"
        : "failed";

    let finalOutput = commandResult.output;
    try {
      // Attempt to extract the last assistant message's content from streaming JSON output
      const lines = commandResult.output.split("\n").filter((l) => l.trim());
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const parsed = JSON.parse(lastLine);
        if (parsed.content) {
          finalOutput = parsed.content;
        }
      }
    } catch {
      // Not JSON or failed to parse, use raw output
    }

    const payload = runBuildResponseSchema.parse({
      build_id: randomUUID(),
      status,
      command: `vibe --workdir ${sessionProjectDir} -p <prompt> --max-turns ${body.dry_run ? "4" : "15"} --output streaming${body.dry_run ? " --agent plan" : ""}`,
      exit_code: commandResult.exitCode,
      output: finalOutput,
      duration_ms: duration,
      notes: [
        commandResult.timedOut ? "Execution timed out before completion." : "Execution completed.",
        `Project workspace: ${sessionProjectDir}`,
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
   * Route: Generate Blueprint (Direct Mistral call, bypasses worker for speed)
   * Generates a React Flow compatible blueprint from chat context.
   */
  app.post("/api/sessions/:id/blueprint/generate", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (!env.mistralApiKey) {
      return reply.status(500).send({ error: "MISTRAL_API_KEY is not configured" });
    }

    const chatContext = await buildChatContext(db, session.id);

    if (!chatContext.trim()) {
      return reply.status(400).send({ error: "No chat context found. Send a message first." });
    }

    const designSummary = await getLatestDesignSummary(db, session.id);

    try {
      const blueprint = await generateArchitectureBlueprint({
        apiKey: env.mistralApiKey,
        model: env.mistralModel,
        chatHistory: chatContext,
        designSummary: designSummary?.summary,
        apiUrl: env.mistralApiUrl
      });

      // Save the blueprint as an artifact for persistence
      const artifactId = randomUUID();
      await insertArtifact(db, {
        id: artifactId,
        session_id: session.id,
        kind: "architecture",
        title: `Blueprint - ${new Date().toISOString().slice(0, 10)}`,
        content_md: blueprint.readme_md,
        content_json: JSON.stringify({
          blueprint_json: blueprint.blueprint_json,
          generated_at: new Date().toISOString()
        })
      });

      return reply.status(200).send({
        artifact_id: artifactId,
        readme_md: blueprint.readme_md,
        blueprint_json: blueprint.blueprint_json
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blueprint generation failed";
      app.log.error({ error, sessionId: session.id }, "Blueprint generation failed");
      return reply.status(502).send({ error: message });
    }
  });

  /**
   * Route: Get Latest Blueprint
   * Returns the latest blueprint with saved positions.
   */
  app.get("/api/sessions/:id/blueprint", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const latestArchitecture = await db.get<{ id: string; content_md: string; content_json: string }>(
      `SELECT id, content_md, content_json
       FROM artifacts
       WHERE session_id = ? AND kind = 'architecture'
       ORDER BY created_at DESC
       LIMIT 1`,
      session.id
    );

    const savedPositions = await getSavedNodePositions(db, session.id);

    if (!latestArchitecture) {
      const emptyPayload = getBlueprintResponseSchema.parse({
        artifact_id: null,
        readme_md: "",
        blueprint_json: null,
        saved_positions: savedPositions
      });
      return reply.status(200).send(emptyPayload);
    }

    const jsonData = parseArtifactJson(latestArchitecture.content_json);
    let blueprintJson = null;
    if (jsonData && typeof jsonData === "object" && "blueprint_json" in (jsonData as Record<string, unknown>)) {
      blueprintJson = (jsonData as Record<string, unknown>).blueprint_json;
    }

    const bpPayload = getBlueprintResponseSchema.parse({
      artifact_id: latestArchitecture.id,
      readme_md: latestArchitecture.content_md,
      blueprint_json: blueprintJson,
      saved_positions: savedPositions
    });

    return reply.status(200).send(bpPayload);
  });

  /**
   * Route: Save Layout
   * Persists the (x, y) positions of React Flow nodes.
   */
  app.post("/api/sessions/:id/blueprint/layout", async (request, reply) => {
    const params = sessionIdParamsSchema.parse(request.params);
    const body = saveLayoutRequestSchema.parse(request.body);
    const session = await getSessionById(db, params.id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    await saveNodePositions(db, session.id, body.positions);

    const layoutPayload = saveLayoutResponseSchema.parse({ saved: true });
    return reply.status(200).send(layoutPayload);
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
