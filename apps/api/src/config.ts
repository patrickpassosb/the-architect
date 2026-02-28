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

export type ApiConfig = {
  redisUrl: string;
  databaseUrl: string;
  port: number;
  host: string;
  serviceName: string;
};

export function loadConfig(): ApiConfig {
  return {
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    port: readInt(process.env.PORT, 8080),
    host: process.env.HOST ?? "0.0.0.0",
    serviceName: process.env.SERVICE_NAME ?? "api"
  };
}
