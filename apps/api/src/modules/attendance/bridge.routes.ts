// Bridge → server protocol. No user token: the bridge's bearer token (hash lookup) identifies it and its tenant; every
// route is listed in public-routes.ts. Bad tokens are rate limited per client address.
import type { Request, Response, Router } from "express";
import { z } from "zod";
import { runWithTenant } from "@idrok/db";
import {
  BridgeEventsSchema,
  BridgeHeartbeatResponseSchema,
  BridgeHeartbeatSchema,
  BridgeJobResultSchema,
  BridgeJobSchema,
  BridgeLeaseSchema,
  IdParamsSchema,
  IngestResultSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { AppError } from "../../http/errors";
import { routesFor } from "../../http/route";
import { SlidingWindow } from "../../infra/rate-limit";
import type { OpenApiRegistry } from "../../openapi/registry";
import { cipherFor } from "./attendance.routes";
import { authenticateBridge, BridgeService, jobPhoto, type BridgeIdentity } from "./bridge.service";
import { completeJob, leaseJobs } from "./device-jobs";

const tags = ["bridge"];
const BAD_TOKEN_LIMIT = 30;
const BAD_TOKEN_WINDOW_MS = 10 * 60_000;

export function bridgeRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const route = routesFor(router, registry);
  const cipher = cipherFor(deps);
  const service = new BridgeService(deps.db, cipher);
  const badTokens = new SlidingWindow(deps.redis, BAD_TOKEN_WINDOW_MS);

  /** Authenticates the bridge and runs `fn` in its tenant. */
  const asBridge = async <T>(req: Request, res: Response, fn: (bridge: BridgeIdentity) => Promise<T>): Promise<T> => {
    const limiterKey = `rl:bridge-token:${req.ip ?? "unknown"}`;
    const state = await badTokens.state(limiterKey);
    if (state.count >= BAD_TOKEN_LIMIT) {
      res.setHeader("Retry-After", String(state.retryAfterSec));
      throw new AppError("RATE_LIMITED", 429);
    }
    const bridge = await authenticateBridge(deps.root, req.headers.authorization);
    if (!bridge) {
      await badTokens.hit(limiterKey);
      throw new AppError("AUTH_REQUIRED", 401);
    }
    return runWithTenant({ tenantId: bridge.tenantId, requestId: String(req.id) }, () => fn(bridge));
  };

  route(
    {
      method: "post",
      path: "/bridge/heartbeat",
      summary: "Bridge heartbeat: reports its state, gets its devices (with credentials) and the poll interval",
      tags,
      access: "public",
      body: BridgeHeartbeatSchema,
      responses: { 200: { description: "Devices", schema: BridgeHeartbeatResponseSchema } },
    },
    async ({ req, res, body }) => res.json(await asBridge(req, res, (b) => service.heartbeat(b, body))),
  );
  route(
    {
      method: "post",
      path: "/bridge/jobs/lease",
      summary: "Lease the bridge's next device jobs",
      tags,
      access: "public",
      body: BridgeLeaseSchema,
      responses: { 200: { description: "Jobs", schema: z.array(BridgeJobSchema) } },
    },
    async ({ req, res, body }) =>
      res.json(await asBridge(req, res, (b) => leaseJobs(deps.db, { bridgeAgentId: b.id }, body.max))),
  );
  route(
    {
      method: "get",
      path: "/bridge/jobs/:id/photo",
      summary: "The face photo (JPEG) of a leased face job",
      tags,
      access: "public",
      params: IdParamsSchema,
      responses: { 200: { description: "JPEG" } },
    },
    async ({ req, res, params }) => {
      const photo = await asBridge(req, res, (b) =>
        jobPhoto(deps.db, deps.storage, cipher, params.id, { bridgeAgentId: b.id }),
      );
      res.type("image/jpeg").send(photo);
    },
  );
  route(
    {
      method: "post",
      path: "/bridge/jobs/:id/result",
      summary: "Report a job's outcome (a late answer to a re-leased job is ignored)",
      tags,
      access: "public",
      params: IdParamsSchema,
      body: BridgeJobResultSchema,
      responses: { 200: { description: "Recorded", schema: z.object({ recorded: z.boolean() }) } },
    },
    async ({ req, res, params, body }) => {
      const recorded = await asBridge(req, res, (b) =>
        completeJob(
          deps.db,
          params.id,
          { bridgeAgentId: b.id },
          {
            ok: body.ok,
            error: body.error ?? undefined,
            result: body.result ?? undefined,
          },
        ),
      );
      res.json({ recorded });
    },
  );
  route(
    {
      method: "post",
      path: "/bridge/events",
      summary: "Terminal events relayed by the bridge (pushed live or read back from the terminal's log)",
      tags,
      access: "public",
      body: BridgeEventsSchema,
      responses: { 200: { description: "Counts", schema: IngestResultSchema } },
    },
    async ({ req, res, body }) => res.json(await asBridge(req, res, (b) => service.events(b, body))),
  );
  route(
    {
      method: "post",
      path: "/bridge/token/rotate",
      summary: "The bridge replaces its own token (the old one works a few more minutes)",
      tags,
      access: "public",
      responses: { 200: { description: "New token", schema: z.object({ token: z.string() }) } },
    },
    async ({ req, res }) => res.json(await asBridge(req, res, (b) => service.rotateToken(b))),
  );
}
