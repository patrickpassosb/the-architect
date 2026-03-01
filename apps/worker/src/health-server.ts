/**
 * @fileoverview A small HTTP server for Health Monitoring.
 *
 * Problem: Tools like Docker or Kubernetes need a way to check if
 * the Worker process is "Healthy" and running correctly.
 *
 * Solution: This lightweight server listens on a separate port (4100)
 * and returns a JSON 'ok' message. It's a "standard" way for
 * infrastructure to keep an eye on our backend processes.
 */

import http from "node:http";

/**
 * Starts a very simple HTTP server on the given port.
 *
 * Problem: We don't want to use a heavy framework (like Fastify)
 * just for a health check in the worker.
 *
 * Solution: Use the built-in 'node:http' module for maximum efficiency.
 */
export function startHealthServer(port: number, serviceName: string) {
  const server = http.createServer((req, res) => {
    // Basic route handling
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

    // Health Check Endpoint (e.g., http://localhost:4100/health)
    if (req.url === "/" || req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          ok: true,
          service: serviceName,
          timestamp: new Date().toISOString()
        })
      );
      return;
    }

    // Return 404 Not Found for any other URL
    res.statusCode = 404;
    res.end();
  });

  // Start the server on the specified port
  server.listen(port, "0.0.0.0");

  return server;
}
