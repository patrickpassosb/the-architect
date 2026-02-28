import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { artifactGenerationJobPayloadSchema } from "@the-architect/shared-types";
import type { ArtifactGenerationJobPayload } from "@the-architect/shared-types";

export const QUEUE_NAMES = {
  artifactGeneration: "artifact_generation"
} as const;

export const JOB_NAMES = {
  artifactGeneration: "artifact_generation"
} as const;

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const options: ConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }

  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }

  if (url.pathname && url.pathname !== "/") {
    const db = Number(url.pathname.slice(1));
    if (!Number.isNaN(db)) {
      options.db = db;
    }
  }

  if (url.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}

export function createArtifactQueue(redisUrl: string): Queue<ArtifactGenerationJobPayload> {
  return new Queue<ArtifactGenerationJobPayload>(QUEUE_NAMES.artifactGeneration, {
    connection: createRedisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2_000
      },
      removeOnComplete: {
        age: 24 * 60 * 60
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60
      }
    }
  });
}

export async function enqueueArtifactGenerationJob(
  queue: Queue<ArtifactGenerationJobPayload>,
  payload: ArtifactGenerationJobPayload
) {
  const validatedPayload = artifactGenerationJobPayloadSchema.parse(payload);

  return queue.add(JOB_NAMES.artifactGeneration, validatedPayload, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2_000
    }
  });
}
