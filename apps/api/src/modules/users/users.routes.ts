import type { Router } from "express";
import { z } from "zod";
import { AccountCreatedSchema, IdParamsSchema, ListQuerySchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { AccountsService } from "./accounts.service";

export function usersRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const accounts = new AccountsService(deps.db, deps.authState);
  const route = routesFor(router, registry);
  const tags = ["users"];

  route(
    {
      method: "get",
      path: "/users",
      summary: "Login accounts",
      tags,
      access: "users.view",
      query: ListQuerySchema.extend({
        roleCode: z.string().max(40).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
      }),
      responses: { 200: { description: "Users" } },
    },
    async ({ res, query }) => res.json(await accounts.list(query)),
  );
  route(
    {
      method: "post",
      path: "/users/:id/reset-password",
      summary: "New temporary password (shown once); sessions are revoked",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Temporary password", schema: AccountCreatedSchema } },
    },
    async ({ res, params }) => res.json(await accounts.resetPassword(params.id)),
  );
  route(
    {
      method: "post",
      path: "/users/:id/disable",
      summary: "Disable a login (sessions are revoked)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Disabled" } },
    },
    async ({ res, auth, params }) => res.json(await accounts.setStatus(auth, params.id, "DISABLED")),
  );
  route(
    {
      method: "post",
      path: "/users/:id/enable",
      summary: "Enable a login",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Enabled" } },
    },
    async ({ res, auth, params }) => res.json(await accounts.setStatus(auth, params.id, "ACTIVE")),
  );
}
