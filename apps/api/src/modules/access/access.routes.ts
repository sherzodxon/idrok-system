import type { Router } from "express";
import { z } from "zod";
import { AssignRolesSchema, RoleSchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { defineRoute } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { AccessService } from "./access.service";

const IdParams = z.object({ id: z.uuid() });

export function accessRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new AccessService(deps.db, deps.authState);

  defineRoute(
    router,
    registry,
    {
      method: "get",
      path: "/permissions",
      summary: "Permission catalogue",
      tags: ["access"],
      access: "roles.view",
      responses: {
        200: { description: "Permissions", schema: z.array(z.object({ code: z.string(), module: z.string() })) },
      },
    },
    ({ res }) => res.json(service.permissions()),
  );

  defineRoute(
    router,
    registry,
    {
      method: "get",
      path: "/roles",
      summary: "Roles of the school with their permissions",
      tags: ["access"],
      access: "roles.view",
      responses: { 200: { description: "Roles", schema: z.array(RoleSchema) } },
    },
    async ({ res }) => res.json(await service.roles()),
  );

  defineRoute(
    router,
    registry,
    {
      method: "put",
      path: "/users/:id/roles",
      summary: "Replace a user's roles",
      tags: ["access"],
      access: "roles.assign",
      params: IdParams,
      body: AssignRolesSchema,
      responses: { 200: { description: "Active role codes", schema: z.object({ roles: z.array(z.string()) }) } },
    },
    async ({ res, auth, params, body }) =>
      res.json({ roles: await service.assignRoles(auth, params.id, body.roleIds) }),
  );
}
