// Default-deny guard (security-baseline.md S1): collects every route Express serves — new routes are covered without
// editing this file — and checks that only listed routes are public and every other route needs a permission.
import express, { type Router } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, SELF_SERVICE_ROUTES, isPublicRoute, isSelfServiceRoute } from "../src/http/public-routes";
import { assertAccessAllowed } from "../src/http/route";
import { servedRoutes, type ServedRoute } from "../src/http/route-guard";
import type { OpenApiRegistry } from "../src/openapi/registry";
import { createTestApp } from "./support/app";

let t: Awaited<ReturnType<typeof createTestApp>>;
let routes: ServedRoute[];
beforeAll(async () => {
  t = await createTestApp();
  routes = servedRoutes(t.app.locals.apiRouter as Router, t.app.locals.routeRegistry as OpenApiRegistry);
});
afterAll(() => t.close());

/** Fills ":id"-style parameters with a syntactically valid uuid. */
const concrete = (path: string) => path.replace(/:\w+/g, "00000000-0000-4000-8000-000000000000");

/** Problems of the route table; an empty list means the API is default-deny. */
async function guardProblems(app: express.Express, list: ServedRoute[]): Promise<string[]> {
  const problems: string[] = [];
  for (const r of list) {
    if (isPublicRoute(r.id)) continue;
    if (r.access === undefined) problems.push(`${r.id}: registered without defineRoute (no access rule)`);
    else if (r.access === "public") problems.push(`${r.id}: public but not in PUBLIC_ROUTES`);
    else if (r.access === "authenticated" && !isSelfServiceRoute(r.id)) problems.push(`${r.id}: no permission and not self-service`);
    const res = await request(app)[r.method as "get"](`/api/v1${concrete(r.path)}`).send({});
    if (res.status !== 401) problems.push(`${r.id}: answered ${res.status} without a token (expected 401)`);
  }
  return problems;
}

describe("route guard", () => {
  it("finds the routes (sanity check)", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.map((r) => r.id)).toEqual(expect.arrayContaining([...PUBLIC_ROUTES, "GET /students", "GET /me"]));
  });

  it("every listed public/self-service route exists (no stale entries)", () => {
    const ids = new Set(routes.map((r) => r.id));
    for (const id of [...PUBLIC_ROUTES, ...SELF_SERVICE_ROUTES]) expect(ids.has(id), id).toBe(true);
  });

  it("every non-public route answers 401 without a token and declares its access", async () => {
    expect(await guardProblems(t.app, routes)).toEqual([]);
  });

  it("every protected route except self-service ones declares a permission", () => {
    const permissionless = routes.filter(
      (r) => !isPublicRoute(r.id) && !isSelfServiceRoute(r.id) && (r.access === "authenticated" || r.access === "public"),
    );
    expect(permissionless).toEqual([]);
  });

  it("the guard itself catches a route left open by mistake", async () => {
    // A raw Express route bypassing defineRoute, as a careless change would add it.
    const rogue = express();
    const router = express.Router();
    router.get("/oops", (_req, res) => {
      res.json({ leaked: true });
    });
    rogue.use("/api/v1", router);
    const problems = await guardProblems(rogue, [{ id: "GET /oops", method: "get", path: "/oops", access: undefined }]);
    expect(problems).toEqual([
      "GET /oops: registered without defineRoute (no access rule)",
      "GET /oops: answered 200 without a token (expected 401)",
    ]);
  });

  it("defineRoute refuses public or permission-less routes that are not listed", () => {
    expect(() => assertAccessAllowed({ method: "get", path: "/secret", access: "public" })).toThrow(/PUBLIC_ROUTES/);
    expect(() => assertAccessAllowed({ method: "get", path: "/secret", access: "authenticated" })).toThrow(/SELF_SERVICE/);
    expect(() => assertAccessAllowed({ method: "get", path: "/secret", access: { anyOf: [] } })).toThrow(/empty/);
    expect(() => assertAccessAllowed({ method: "get", path: "/secret", access: "students.view" })).not.toThrow();
  });
});
