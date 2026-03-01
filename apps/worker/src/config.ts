/**
 * @fileoverview Configuration Management for the Worker Service.
 *
 * Problem: The Worker needs to know where Redis and the Database are.
 * These values can change depending on if we are running locally,
 * in Docker, or in Production.
 *
 * Solution: Centralize the loading of these settings from 'process.env'
 * and provide sensible default values for local development.
 */

const DEFAULT_DATABASE_URL = "./data/the-architect.sqlite";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

/**
 * Helper: Safely convert an environment variable string into an integer.
 */
function readInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/**
 * The configuration object used by the worker bootstrap process.
 */
export type WorkerConfig = {
  redisUrl: string;
  databaseUrl: string;
  // How many jobs can the worker process at the same time?
  workerConcurrency: number;
  // Which port should the health server listen on?
  port: number;
  // Name of the service for logging and health checks
  serviceName: string;
};

/**
 * Problem: We don't want to scatter 'process.env' calls throughout the code.
 * Solution: Load all configuration at once at the start of the process.
 */
export function loadConfig(): WorkerConfig {
  return {
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    workerConcurrency: readInt(process.env.WORKER_CONCURRENCY, 4),
    port: readInt(process.env.WORKER_PORT, 4100),
    serviceName: process.env.SERVICE_NAME ?? "worker"
  };
}
