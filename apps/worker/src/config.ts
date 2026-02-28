const DEFAULT_DATABASE_URL = "./data/the-architect.sqlite";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

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

export type WorkerConfig = {
  redisUrl: string;
  databaseUrl: string;
  workerConcurrency: number;
  port: number;
  serviceName: string;
};

export function loadConfig(): WorkerConfig {
  return {
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    workerConcurrency: readInt(process.env.WORKER_CONCURRENCY, 4),
    port: readInt(process.env.WORKER_PORT, 4100),
    serviceName: process.env.SERVICE_NAME ?? "worker"
  };
}
