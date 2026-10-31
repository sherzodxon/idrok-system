import { Router } from "express";

/** A dependency probe for /readyz; it throws when the dependency is not usable. */
export type ReadinessCheck = () => Promise<void>;

export function healthRouter(checks: Record<string, ReadinessCheck>): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/readyz", async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          return [name, "fail"] as const;
        }
      }),
    );
    const result = Object.fromEntries(entries);
    const ready = entries.every(([, state]) => state === "ok");
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "fail", checks: result });
  });

  return router;
}
