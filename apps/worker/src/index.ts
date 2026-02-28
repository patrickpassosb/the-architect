import "dotenv/config";
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
import {
  ArtifactGenerationJobPayload,
  artifactGenerationJobPayloadSchema
} from "@the-architect/shared-types";
import { loadConfig } from "./config";
import { startHealthServer } from "./health-server";

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
