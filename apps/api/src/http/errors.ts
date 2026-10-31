import type { ErrorRequestHandler, RequestHandler } from "express";
// Brings in pino-http's `req.log` / `req.id` typings for every compilation that includes this file (e.g. the worker).
import type {} from "pino-http";
import { ZodError } from "zod";
import { Prisma, TenantContextMissingError, TenantMismatchError } from "@idrok/db";
import { errorMessageKey, type ApiErrorBody, type ErrorCode } from "@idrok/shared";

/** An expected failure: `code` is machine-readable, the message sent to clients is its translation key. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const notFound = (details?: Record<string, unknown>) => new AppError("NOT_FOUND", 404, details);
export const forbidden = (details?: Record<string, unknown>) => new AppError("FORBIDDEN", 403, details);

const body = (code: ErrorCode, details?: Record<string, unknown>): ApiErrorBody => ({
  error: { code, message: errorMessageKey(code), ...(details ? { details } : {}) },
});

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND"));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(body(err.code, err.details));
    return;
  }
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
    res.status(400).json(body("VALIDATION_ERROR", { fields }));
    return;
  }
  // Malformed JSON from express.json().
  if (err instanceof SyntaxError && "status" in err && err.status === 400) {
    res.status(400).json(body("VALIDATION_ERROR", { fields: [{ path: "", code: "invalid_json" }] }));
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json(body("CONFLICT"));
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    res.status(404).json(body("NOT_FOUND"));
    return;
  }
  if (err instanceof TenantContextMissingError || err instanceof TenantMismatchError) {
    req.log?.error({ err }, "tenant isolation violation");
  } else {
    req.log?.error({ err }, "unhandled error");
  }
  res.status(500).json(body("INTERNAL_ERROR", { requestId: req.id }));
};
