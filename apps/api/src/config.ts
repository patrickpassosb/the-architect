/**
 * @fileoverview Configuration Management for the API Service.
 *
 * Problem: The API needs to know where to listen for requests (port/host)
 * and how to connect to the Database and Redis.
 *
 * Solution: Centralize configuration loading from environment variables.
 * This makes it easy to change settings without modifying the source code.
 */

const DEFAULT_DATABASE_URL = "./data/the-architect.sqlite";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

/**
 * Helper: Safely parse a number from a string, with a fallback value.
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
 * The API configuration object.
 */
export type ApiConfig = {
  redisUrl: string;
  databaseUrl: string;
  port: number;
  host: string;
  serviceName: string;
};

/**
 * Main function: Loads all settings from 'process.env'.
 */
export function loadConfig(): ApiConfig {
  return {
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    // Port: What port the server listens on (default: 8080)
    port: readInt(process.env.PORT, 8080),
    // Host: Typically 0.0.0.0 to listen on all network interfaces
    host: process.env.HOST ?? "0.0.0.0",
    serviceName: process.env.SERVICE_NAME ?? "api"
  };
}
