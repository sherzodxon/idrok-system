// Terminal → server: Hikvision "HTTP listening" pushes AccessControllerEvent as multipart/form-data (a JSON part,
// usually `event_log`, plus a snapshot picture) or as a JSON body. The device is identified by the key in the path —
// Hikvision cannot send headers — whose hash is looked up; the tenant comes from that device, never from the request.
// Snapshot pictures are not stored (no biometric data from events). Bad keys are rate limited per client address.
import type { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { runWithTenant } from "@idrok/db";
import { IngestResultSchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { AppError, notFound } from "../../http/errors";
import { routesFor } from "../../http/route";
import { sha256Hex } from "../../infra/crypto";
import { SlidingWindow } from "../../infra/rate-limit";
import type { OpenApiRegistry } from "../../openapi/registry";
import { ingestEvents } from "./ingest";

const BAD_KEY_LIMIT = 30;
const BAD_KEY_WINDOW_MS = 10 * 60_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 4, fields: 10, fieldSize: 256 * 1024 },
});

function receive(req: Request, res: Response): Promise<void> {
  if (!req.is("multipart/form-data")) return Promise.resolve();
  return new Promise((resolve, reject) =>
    upload.any()(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) reject(new AppError("VALIDATION_ERROR", 400, { reason: err.code }));
      else if (err) reject(err instanceof Error ? err : new Error("multipart"));
      else resolve();
    }),
  );
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isEvent = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && typeof (v as { eventType?: unknown }).eventType === "string";

/** The event objects of one push, whatever the part names are. */
export function collectEvents(req: Request): unknown[] {
  const out: unknown[] = [];
  const body = req.body as unknown;
  if (isEvent(body)) out.push(body);
  else if (body && typeof body === "object") {
    for (const value of Object.values(body as Record<string, unknown>)) {
      const parsed = typeof value === "string" ? tryJson(value) : value;
      if (isEvent(parsed)) out.push(parsed);
    }
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const f of files) {
    if (!/json|text\/plain/.test(f.mimetype) && f.originalname !== "") continue;
    const parsed = tryJson(f.buffer.toString("utf8"));
    if (isEvent(parsed)) out.push(parsed);
  }
  return out;
}

export function webhookRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const route = routesFor(router, registry);
  const badKeys = new SlidingWindow(deps.redis, BAD_KEY_WINDOW_MS);

  route(
    {
      method: "post",
      path: "/attendance/hikvision-event/:key",
      summary: "Hikvision terminal event push (authenticated by the device key in the path)",
      tags: ["attendance"],
      access: "public",
      params: z.object({ key: z.string().min(16).max(128) }),
      responses: { 200: { description: "Counts", schema: IngestResultSchema } },
    },
    async ({ req, res, params }) => {
      const limiterKey = `rl:device-key:${req.ip ?? "unknown"}`;
      const state = await badKeys.state(limiterKey);
      if (state.count >= BAD_KEY_LIMIT) {
        res.setHeader("Retry-After", String(state.retryAfterSec));
        throw new AppError("RATE_LIMITED", 429);
      }
      const device = await deps.root.device.findUnique({
        where: { webhookKeyHash: sha256Hex(params.key) },
        select: { id: true, tenantId: true, direction: true, isActive: true, archivedAt: true },
      });
      if (!device || device.archivedAt) {
        await badKeys.hit(limiterKey);
        throw notFound();
      }
      await receive(req, res);
      const raws = collectEvents(req);
      const result = await runWithTenant({ tenantId: device.tenantId, requestId: String(req.id) }, async () => {
        const r = device.isActive
          ? await ingestEvents(deps.db, device, raws, "WEBHOOK")
          : { accepted: 0, duplicates: 0, ignored: raws.length, unmatched: 0, lastEventAt: null };
        await deps.db.device.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date(), ...(r.lastEventAt ? { lastEventAt: r.lastEventAt } : {}) },
        });
        return r;
      });
      const { lastEventAt: _l, ...counts } = result;
      res.json(counts);
    },
  );
}
