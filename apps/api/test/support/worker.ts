import request from "supertest";
import { expect } from "vitest";
import { startWorker } from "../../src/worker";
import type { createTestApp } from "./app";

type T = Awaited<ReturnType<typeof createTestApp>>;

export const startTestWorker = (t: T) => startWorker(t.env, t.deps.logger);

/** Polls the import until it reaches one of `statuses`. */
export async function waitForImport(
  t: T,
  auth: Record<string, string>,
  id: string,
  statuses: string[],
  timeoutMs = 60_000,
) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(t.app).get(`/api/v1/imports/${id}`).set(auth);
    expect(res.status).toBe(200);
    if (statuses.includes(res.body.status)) return res.body;
    if (Date.now() > until) throw new Error(`import ${id} stuck in ${res.body.status}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
