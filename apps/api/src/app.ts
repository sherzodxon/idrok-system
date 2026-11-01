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
import { accessRoutes, roleAdminRoutes } from "./modules/access/access.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { calendarRoutes } from "./modules/calendar/calendar.routes";
import { timetableRoutes } from "./modules/timetable/timetable.routes";
import { lessonRoutes } from "./modules/lessons/lessons.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { importsRoutes } from "./modules/imports/imports.routes";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { meRoutes } from "./modules/me/me.routes";
import { peopleRoutes } from "./modules/people/people.routes";
import { structureRoutes } from "./modules/structure/structure.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { OpenApiRegistry } from "./openapi/registry";
import { routesFor } from "./http/route";

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
  // A JSON API: nothing may be rendered, framed or cached (CSP 'none'); same-site so the web app may show files.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use((_req, res, next) => {
    // Responses carry personal data; routes that are safe to cache (public branding) override this.
    res.setHeader("Cache-Control", "no-store");
    next();
  });
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
  roleAdminRoutes(v1, registry, deps);
  auditRoutes(v1, registry, deps);
  structureRoutes(v1, registry, deps);
  calendarRoutes(v1, registry, deps);
  timetableRoutes(v1, registry, deps);
  lessonRoutes(v1, registry, deps);
  peopleRoutes(v1, registry, deps);
  usersRoutes(v1, registry, deps);
  importsRoutes(v1, registry, deps);
  settingsRoutes(v1, registry, deps);

  routesFor(v1, registry)(
    {
      method: "get",
      path: "/openapi.json",
      summary: "This document",
      tags: ["meta"],
      access: "authenticated",
      responses: { 200: { description: "OpenAPI 3.1" } },
    },
    ({ res }) => res.json(registry.document({ title: "Idrok System API", version: "1" })),
  );

  app.use("/api/v1", v1);
  // Exposed for the route-guard test, which walks every route actually served.
  app.locals.apiRouter = v1;
  app.locals.routeRegistry = registry;
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
