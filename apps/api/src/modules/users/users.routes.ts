import type { Router } from "express";
import { z } from "zod";
import {
  AccountCreatedSchema,
  ChangeUsernameSchema,
  IdParamsSchema,
  LinkEmployeeSchema,
  ListQuerySchema,
  UserDetailSchema,
} from "@idrok/shared";
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
  route(
    {
      method: "get",
      path: "/users/:id",
      summary: "One login account: card, roles, open sessions and activity of the last 30 days",
      tags,
      access: "users.view",
      params: IdParamsSchema,
      responses: { 200: { description: "User", schema: UserDetailSchema } },
    },
    async ({ res, params }) => res.json(await accounts.detail(params.id)),
  );
  route(
    {
      method: "put",
      path: "/users/:id/username",
      summary: "New login name (not for guardians: their login is the phone); open sessions are closed",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      body: ChangeUsernameSchema,
      responses: { 200: { description: "Changed", schema: z.object({ id: z.uuid(), username: z.string() }) } },
    },
    async ({ res, params, body }) => res.json(await accounts.changeUsername(params.id, body.username)),
  );
  route(
    {
      method: "post",
      path: "/users/:id/link-employee",
      summary: "Give a system account an employee card (existing without a login, or new)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      body: LinkEmployeeSchema,
      responses: { 200: { description: "User", schema: UserDetailSchema } },
    },
    async ({ res, params, body }) => res.json(await accounts.linkEmployee(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/users/:id/sessions/revoke",
      summary: "Close every open session of the user (logout everywhere)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Closed", schema: z.object({ revoked: z.number().int() }) } },
    },
    async ({ res, params }) => res.json(await accounts.revokeSessions(params.id)),
  );
}
