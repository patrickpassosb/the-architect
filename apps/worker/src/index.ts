/**
 * @fileoverview Background Worker for 'The Architect'.
 *
 * Problem: Generating technical documents (artifacts) is a slow process
 * that shouldn't block the main API response.
 *
 * Solution: This 'Worker' process listens to a Redis queue (BullMQ).
 * When a new job arrives, it picks it up, generates the document
 * using our 'core' logic, and saves the final result to the database.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  createRedisConnection,
  generateArtifactsFromJob,
  insertArtifact,
  log,
  openDatabase,
  runMigrations,
  upsertJobStatus,
  ensureSessionExists
} from "@the-architect/core";
import * as sharedTypes from "../../../packages/shared-types/dist/index.js";
import type { ArtifactGenerationJobPayload } from "../../../packages/shared-types/dist/index.js";
import { loadConfig } from "./config";
import { startHealthServer } from "./health-server";

// Import Zod schemas to ensure the data in the queue is valid
const { artifactGenerationJobPayloadSchema } = sharedTypes;

/**
 * Helper: Find the project root to load .env files.
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
 * Helper: Load environment variables for the worker.
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

// Load env before starting
loadEnvironment();

/**
 * Main Worker Startup Function
 */
async function bootstrap() {
  const config = loadConfig();

  // 1. Connect to the same database the API uses
  const db = await openDatabase(config.databaseUrl);
  await runMigrations(db);

  // 2. Connect to Redis
  const redisConnection = createRedisConnection(config.redisUrl);

  /**
   * Problem: We need to process jobs one by one without losing any work.
   * Solution: Create a BullMQ 'Worker'. It automatically pulls jobs from Redis.
   */
  const worker = new Worker<ArtifactGenerationJobPayload>(
    QUEUE_NAMES.artifactGeneration,
    async (job) => {
      // Validate the data received from the queue
      const payload = artifactGenerationJobPayloadSchema.parse(job.data);

      log("info", "Processing artifact generation job", {
        queue: QUEUE_NAMES.artifactGeneration,
        jobId: job.id,
        sessionId: payload.session.id,
        attemptsMade: job.attemptsMade
      });

      // Update the database to say this job is now 'active'
      await upsertJobStatus(db, {
        id: job.id ?? "unknown",
        session_id: payload.session.id,
        kind: "artifact_generation",
        status: "active"
      });

      // Reliability: Ensure the session still exists in the DB
      await ensureSessionExists(db, payload.session);

      // Transform the AI structured response into Markdown documents
      const generatedArtifacts = generateArtifactsFromJob(payload);

      // Save each generated document (artifact) to the database
      for (const artifact of generatedArtifacts) {
        await insertArtifact(db, artifact);
      }

      // Return a result (saved in Redis for tracking)
      return {
        created_artifact_ids: generatedArtifacts.map((artifact) => artifact.id),
        count: generatedArtifacts.length
      };
    },
    {
      connection: redisConnection,
      // Concurrency: How many jobs can this worker run at the same time?
      concurrency: config.workerConcurrency
    }
  );

  /**
   * Event Listener: Job Completed Successfully
   */
  worker.on("completed", async (job, result) => {
    const payload = artifactGenerationJobPayloadSchema.parse(job.data);

    // Update status to 'completed' so the frontend knows the document is ready
    await upsertJobStatus(db, {
      id: job.id ?? "unknown",
      session_id: payload.session.id,
      kind: "artifact_generation",
      status: "completed"
    });

    log("info", "Artifact generation job completed", {
      jobId: job.id,
      sessionId: payload.session.id,
      result
    });
  });

  /**
   * Event Listener: Job Failed
   */
  worker.on("failed", async (job, err) => {
    const sessionId = job?.data?.session?.id ?? "unknown";

    // Mark as 'failed' and save the error message for debugging
    await upsertJobStatus(db, {
      id: job?.id ?? "unknown",
      session_id: sessionId,
      kind: "artifact_generation",
      status: "failed",
      error: err.message
    });

    log("error", "Artifact generation job failed", {
      jobId: job?.id,
      sessionId,
      attemptsMade: job?.attemptsMade,
      error: err.message
    });
  });

  /**
   * Event Listener: Internal Worker Error (e.g., Redis connection lost)
   */
  worker.on("error", (err) => {
    log("error", "Worker runtime error", { error: err.message });
  });

  // 3. Start a small health-check server for Docker/Kubernetes
  const server = startHealthServer(config.port, config.serviceName);

  log("info", "Worker started", {
    queue: QUEUE_NAMES.artifactGeneration,
    concurrency: config.workerConcurrency,
    port: config.port
  });

  /**
   * Graceful Shutdown handlers
   */
  const shutdown = async (signal: string) => {
    log("warn", "Shutting down worker", { signal });

    await worker.close();
    await db.close();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

// Start the worker!
bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  log("error", "Worker failed to start", { error: message });
  process.exit(1);
});
