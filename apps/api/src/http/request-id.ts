import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses an upstream X-Request-Id when it looks safe, otherwise generates one. */
export function requestId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();
}
