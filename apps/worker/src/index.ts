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

const { artifactGenerationJobPayloadSchema } = sharedTypes;

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

async function bootstrap() {
  const config = loadConfig();
  const db = await openDatabase(config.databaseUrl);
  await runMigrations(db);

  const redisConnection = createRedisConnection(config.redisUrl);
  const worker = new Worker<ArtifactGenerationJobPayload>(
    QUEUE_NAMES.artifactGeneration,
    async (job) => {
      const payload = artifactGenerationJobPayloadSchema.parse(job.data);

      log("info", "Processing artifact generation job", {
        queue: QUEUE_NAMES.artifactGeneration,
        jobId: job.id,
        sessionId: payload.session.id,
        attemptsMade: job.attemptsMade
      });

      await upsertJobStatus(db, {
        id: job.id ?? "unknown",
        session_id: payload.session.id,
        kind: "artifact_generation",
        status: "active"
      });

      await ensureSessionExists(db, payload.session);

      const generatedArtifacts = generateArtifactsFromJob(payload);
      for (const artifact of generatedArtifacts) {
        await insertArtifact(db, artifact);
      }

      return {
        created_artifact_ids: generatedArtifacts.map((artifact) => artifact.id),
        count: generatedArtifacts.length
      };
    },
    {
      connection: redisConnection,
      concurrency: config.workerConcurrency
    }
  );

  worker.on("completed", async (job, result) => {
    const payload = artifactGenerationJobPayloadSchema.parse(job.data);

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

  worker.on("failed", async (job, err) => {
    const sessionId = job?.data?.session?.id ?? "unknown";

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

  worker.on("error", (err) => {
    log("error", "Worker runtime error", { error: err.message });
  });

  const server = startHealthServer(config.port, config.serviceName);

  log("info", "Worker started", {
    queue: QUEUE_NAMES.artifactGeneration,
    concurrency: config.workerConcurrency,
    port: config.port
  });

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

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  log("error", "Worker failed to start", { error: message });
  process.exit(1);
});
