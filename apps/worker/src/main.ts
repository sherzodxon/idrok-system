import { startWorker } from "@idrok/api/worker";
import { loadEnv } from "@idrok/api/config";

// Processors, the outbox relay and maintenance live in the API codebase (one code base, separate process).
const worker = await startWorker(loadEnv());

const shutdown = (signal: string) => {
  worker.deps.logger.info({ signal }, "worker stopping");
  void worker.stop().then(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
