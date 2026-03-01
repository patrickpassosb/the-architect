/**
 * @fileoverview Lightweight logging system for the entire project.
 *
 * Problem: When running multiple services (API, Worker),
 * it's hard to track what's happening just with `console.log`.
 *
 * Solution: A simple JSON logger that makes logs machine-readable
 * (great for tools like Datadog or ELK) and includes timestamps and levels.
 */

export type LogLevel = "info" | "warn" | "error";

/**
 * Log a message with a specific level and optional extra details.
 *
 * Problem: We need to see not just *what* happened, but *when* and *with what data*.
 * Solution: Every log is converted to a JSON object with a timestamp.
 */
export function log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    // Include any extra information passed (e.g., sessionId, artifactId)
    ...(fields ?? {})
  };

  // Convert the object to a single-line string for better log management.
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  // Default: Log to standard output.
  console.log(line);
}
