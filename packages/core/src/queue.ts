/**
 * @fileoverview Redis Queue management using BullMQ.
 *
 * Problem: Generating deep technical documents (artifacts) with an AI model
 * can take a long time (10-30 seconds). If we did this directly in our
 * main API, the user would see a "Loading..." spinner for too long,
 * and the request might even time out.
 *
 * Solution: Use a background task queue (BullMQ). The API puts a "job"
 * into the queue and tells the user "We're working on it!". A separate
 * 'Worker' process picks up that job and finishes it in the background.
 */

import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import * as sharedTypes from "../../shared-types/dist/index.js";
import type { ArtifactGenerationJobPayload } from "../../shared-types/dist/index.js";

const { artifactGenerationJobPayloadSchema } = sharedTypes;

// Defined constants for our Queue and Job names
export const QUEUE_NAMES = {
  artifactGeneration: "artifact_generation"
} as const;

export const JOB_NAMES = {
  artifactGeneration: "artifact_generation"
} as const;

/**
 * Helper: Converts a Redis URL (e.g., redis://localhost:6379)
 * into a configuration object that BullMQ can understand.
 */
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

  // Use TLS (SSL) if the protocol is 'rediss' (secure Redis)
  if (url.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}

/**
 * Problem: We need a reliable way to add and track background tasks.
 * Solution: Create a BullMQ 'Queue'. This object allows us to "push"
 * new work into Redis.
 */
export function createArtifactQueue(redisUrl: string): Queue<ArtifactGenerationJobPayload> {
  return new Queue<ArtifactGenerationJobPayload>(QUEUE_NAMES.artifactGeneration, {
    connection: createRedisConnection(redisUrl),
    defaultJobOptions: {
      // Reliability: If a job fails, try it again up to 5 times.
      attempts: 5,
      // Strategy: Wait longer between each retry (exponential backoff).
      backoff: {
        type: "exponential",
        delay: 2_000 // Start with a 2-second delay.
      },
      // Cleanup: Delete successful jobs after 24 hours to keep Redis clean.
      removeOnComplete: {
        age: 24 * 60 * 60
      },
      // Cleanup: Delete failed jobs after 7 days so we have time to debug them.
      removeOnFail: {
        age: 7 * 24 * 60 * 60
      }
    }
  });
}

/**
 * Adds a new 'artifact_generation' job to the queue.
 *
 * Problem: We shouldn't put invalid data into the queue.
 * Solution: Validate the 'payload' against our Zod schema before adding it.
 */
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
