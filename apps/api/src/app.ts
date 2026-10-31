import express from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { healthRouter, type ReadinessCheck } from "./http/health";

export interface AppDeps {
  logger: Logger;
  readiness: Record<string, ReadinessCheck>;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(express.json({ limit: "1mb" }));

  const v1 = express.Router();
  v1.use(healthRouter(deps.readiness));
  app.use("/api/v1", v1);

  return app;
}
