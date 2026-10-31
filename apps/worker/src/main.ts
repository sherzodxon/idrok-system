import { pino } from "pino";

// Background jobs (BullMQ processors, outbox relay, cron) are registered here from step 5 on.
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

logger.info("worker started");

const shutdown = (signal: string) => {
  logger.info({ signal }, "worker stopping");
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
setInterval(() => logger.debug("worker alive"), 60_000);
