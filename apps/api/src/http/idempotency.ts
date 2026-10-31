// Idempotency-Key support for write requests (api-plan.md §1.4): a repeated key replays the first response;
// the same key with a different body is a conflict.
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { currentTenantContext, runWithTenant, type Prisma } from "@idrok/db";
import type { AppDeps } from "../deps";
import { AppError } from "./errors";

const KEY = /^[A-Za-z0-9_-]{16,100}$/;
const TTL_MS = 24 * 3_600_000;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function idempotency(deps: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (!WRITE_METHODS.has(req.method) || typeof key !== "string" || !req.auth) return next();
    if (!KEY.test(key))
      return next(new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "Idempotency-Key", code: "invalid" }] }));

    const userId = req.auth.userId;
    const requestHash = createHash("sha256")
      .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
      .digest("hex");

    try {
      const existing = await deps.db.idempotencyRecord.findFirst({
        where: { userId, key, expiresAt: { gt: new Date() } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
        res.setHeader("Idempotent-Replayed", "true");
        if (existing.responseBody === null) return res.status(existing.statusCode).end();
        return res.status(existing.statusCode).json(existing.responseBody);
      }
    } catch (err) {
      return next(err);
    }

    // Capture the first response and store it once it succeeded (5xx is never stored: the client may retry).
    const json = res.json.bind(res);
    let captured: unknown = null;
    res.json = (body: unknown) => {
      captured = body;
      return json(body);
    };
    const context = currentTenantContext();
    res.on("finish", () => {
      if (res.statusCode >= 500 || !context) return;
      // 'finish' fires outside the request's async context, so the tenant context is restored explicitly.
      runWithTenant(context, () =>
        deps.db.idempotencyRecord.create({
          data: {
            tenantId: context.tenantId,
            userId,
            key,
            method: req.method,
            path: req.originalUrl,
            requestHash,
            statusCode: res.statusCode,
            responseBody: (captured ?? undefined) as Prisma.InputJsonValue | undefined,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        }),
      ).catch((err: unknown) => req.log?.warn({ err }, "idempotency record not stored"));
    });
    next();
  };
}
