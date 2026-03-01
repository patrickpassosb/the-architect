/**
 * @fileoverview Configuration Management for the API Service.
 *
 * Problem: The API needs to know where to listen for requests (port/host)
 * and how to connect to the Database and Redis.
 *
 * Solution: Centralize configuration loading from environment variables.
 * This makes it easy to change settings without modifying the source code.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATABASE_URL = "./data/the-architect.sqlite";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const DEFAULT_SANDBOX_MEMORY = "2g";
const DEFAULT_SANDBOX_CPUS = "1.0";

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
  sandboxImage: string;
  sandboxMemoryLimit: string;
  sandboxCpuLimit: number;
  projectsRoot: string;
};

/**
 * Main function: Loads all settings from 'process.env'.
 */
export function loadConfig(): ApiConfig {
  const repoRoot = findRepoRoot(process.cwd());
  
  return {
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    port: readInt(process.env.PORT, 8080),
    host: process.env.HOST ?? "0.0.0.0",
    serviceName: process.env.SERVICE_NAME ?? "api",
    sandboxImage: process.env.SANDBOX_DOCKER_IMAGE ?? "architect-vibe-image",
    sandboxMemoryLimit: process.env.SANDBOX_MEMORY_LIMIT ?? DEFAULT_SANDBOX_MEMORY,
    sandboxCpuLimit: parseFloat(process.env.SANDBOX_CPU_LIMIT ?? DEFAULT_SANDBOX_CPUS),
    projectsRoot: process.env.PROJECTS_ROOT ?? path.join(repoRoot, "projects")
  };
}

function findRepoRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (Array.isArray(packageJson.workspaces)) {
          return currentDir;
        }
      } catch {
        // Ignore
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}
