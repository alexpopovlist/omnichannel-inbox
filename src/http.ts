import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { env } from "./env.js";

export function buildServer() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  // Required for webhook signature verification (optional)
  app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  return app;
}
