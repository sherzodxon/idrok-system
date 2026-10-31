// One declaration per endpoint: validation, access rule and OpenAPI entry come from the same object.
import type { Request, Response, Router } from "express";
import type { z } from "zod";
import type { PermissionCode } from "@idrok/shared";
import type { OpenApiRegistry } from "../openapi/registry";
import { requireAuth, requirePermission, type RequestAuth } from "./auth";
import { parse } from "./validate";

export type Access = "public" | "authenticated" | PermissionCode;

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
  registry.add(def as RouteDef);
  router[def.method](def.path, async (req, res, next) => {
    try {
      const auth =
        def.access === "public"
          ? req.auth
          : def.access === "authenticated"
            ? requireAuth(req)
            : requirePermission(req, def.access as PermissionCode);
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
