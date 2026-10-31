import { createApp } from "./app";
import { buildDeps, closeDeps } from "./bootstrap";
import { loadEnv } from "./config/env";

const env = loadEnv();
const deps = buildDeps(env);
const server = createApp(deps).listen(env.PORT, () => deps.logger.info({ port: env.PORT }, "api listening"));

const shutdown = (signal: string) => {
  deps.logger.info({ signal }, "api stopping");
  server.close(() => void closeDeps(deps).then(() => process.exit(0)));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
