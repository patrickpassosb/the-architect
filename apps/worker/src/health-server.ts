import http from "node:http";

export function startHealthServer(port: number, serviceName: string) {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

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

    res.statusCode = 404;
    res.end();
  });

  server.listen(port, "0.0.0.0");

  return server;
}
