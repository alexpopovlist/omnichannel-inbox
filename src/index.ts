import { app } from "./routes.js";
import { env } from "./env.js";

async function main() {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
