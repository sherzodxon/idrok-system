// One declaration per endpoint: validation, access rule and OpenAPI entry come from the same object.
import type { Request, Response, Router } from "express";
import type { z } from "zod";
import type { PermissionCode } from "@idrok/shared";
import type { OpenApiRegistry } from "../openapi/registry";
import { requireAnyPermission, requireAuth, requirePermission, type RequestAuth } from "./auth";
import { isPublicRoute, isSelfServiceRoute, routeId } from "./public-routes";
import { parse } from "./validate";

/**
 * Who may call a route: a permission code (the default case), any of several codes, or — only for routes listed in
 * public-routes.ts — "public" / "authenticated".
 */
export type Access = "public" | "authenticated" | PermissionCode | { anyOf: readonly PermissionCode[] };

export interface RouteDef<
  B extends z.ZodType | undefined = z.ZodType | undefined,
  Q extends z.ZodType | undefined = z.ZodType | undefined,
  P extends z.ZodType | undefined = z.ZodType | undefined,
> {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  summary: string;
  tags: string[];
  access: Access;
  body?: B;
  query?: Q;
  params?: P;
  responses: Record<number, { description: string; schema?: z.ZodType }>;
}

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

export interface RouteContext<B, Q, P, A> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  auth: A;
}

export function defineRoute<
  B extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  P extends z.ZodType | undefined = undefined,
  const A extends Access = Access,
>(
  router: Router,
  registry: OpenApiRegistry,
  def: RouteDef<B, Q, P> & { access: A },
  handler: (
    ctx: RouteContext<Infer<B>, Infer<Q>, Infer<P>, A extends "public" ? RequestAuth | undefined : RequestAuth>,
  ) => Promise<unknown> | unknown,
) {
  assertAccessAllowed(def);
  registry.add(def as RouteDef);
  router[def.method](def.path, async (req, res, next) => {
    try {
      const auth = checkAccess(req, def.access);
      const ctx = {
        req,
        res,
        body: (def.body ? parse(def.body, req.body ?? {}) : undefined) as Infer<B>,
        query: (def.query ? parse(def.query, req.query) : undefined) as Infer<Q>,
        params: (def.params ? parse(def.params, req.params) : undefined) as Infer<P>,
        auth: auth as A extends "public" ? RequestAuth | undefined : RequestAuth,
      };
      await handler(ctx);
    } catch (err) {
      next(err);
    }
  });
}

/** `defineRoute` bound to one router and registry (shorter route files). */
export function routesFor(router: Router, registry: OpenApiRegistry) {
  return <
    B extends z.ZodType | undefined = undefined,
    Q extends z.ZodType | undefined = undefined,
    P extends z.ZodType | undefined = undefined,
    const A extends Access = Access,
  >(
    def: RouteDef<B, Q, P> & { access: A },
    handler: (
      ctx: RouteContext<Infer<B>, Infer<Q>, Infer<P>, A extends "public" ? RequestAuth | undefined : RequestAuth>,
    ) => Promise<unknown> | unknown,
  ) => defineRoute(router, registry, def, handler);
}

/** Fails at startup when a route is public or permission-less without being listed in public-routes.ts. */
export function assertAccessAllowed(def: Pick<RouteDef, "method" | "path" | "access">) {
  const id = routeId(def.method, def.path);
  if (def.access === "public" && !isPublicRoute(id)) throw new Error(`${id} is public but not listed in PUBLIC_ROUTES`);
  if (def.access === "authenticated" && !isSelfServiceRoute(id)) {
    throw new Error(`${id} has no permission but is not listed in SELF_SERVICE_ROUTES`);
  }
  if (typeof def.access === "object" && def.access.anyOf.length === 0)
    throw new Error(`${id} has an empty permission list`);
}

function checkAccess(req: Request, access: Access): RequestAuth | undefined {
  if (access === "public") return req.auth;
  if (access === "authenticated") return requireAuth(req);
  if (typeof access === "object") return requireAnyPermission(req, access.anyOf);
  return requirePermission(req, access);
}
