import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppDeps } from "./deps";
import { authenticate, csrfProtection, passwordChangeGate } from "./http/auth";
import { errorHandler, notFoundHandler } from "./http/errors";
import { healthRouter } from "./http/health";
import { idempotency } from "./http/idempotency";
import { requestId } from "./http/request-id";
import { accessRoutes } from "./modules/access/access.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { meRoutes } from "./modules/me/me.routes";
import { peopleRoutes } from "./modules/people/people.routes";
import { structureRoutes } from "./modules/structure/structure.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { OpenApiRegistry } from "./openapi/registry";

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const id = requestId(req);
        res.setHeader("X-Request-Id", id);
        return id;
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: deps.env.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "Idempotency-Key", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Idempotent-Replayed"],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  const registry = new OpenApiRegistry();
  const v1 = express.Router();
  v1.use(healthRouter(deps.readiness));
  v1.use(authenticate(deps), csrfProtection, passwordChangeGate, idempotency(deps));

  authRoutes(v1, registry, deps);
  meRoutes(v1, registry, deps);
  accessRoutes(v1, registry, deps);
  structureRoutes(v1, registry, deps);
  peopleRoutes(v1, registry, deps);
  usersRoutes(v1, registry, deps);

  v1.get("/openapi.json", (_req, res) => {
    res.json(registry.document({ title: "Idrok System API", version: "1" }));
  });

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
