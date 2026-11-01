import type { Router } from "express";
import { z } from "zod";
import { AssignRolesSchema, CreateRoleSchema, RoleSchema, SetRolePermissionsSchema, UpdateRoleSchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { defineRoute, routesFor } from "../../http/route";
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

export function roleAdminRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new AccessService(deps.db, deps.authState);
  const route = routesFor(router, registry);
  const tags = ["access"];
  route(
    { method: "post", path: "/roles", summary: "Create a school role", tags, access: "roles.manage", body: CreateRoleSchema, responses: { 201: { description: "Created", schema: RoleSchema } } },
    async ({ res, body }) => res.status(201).json(await service.createRole(body)),
  );
  route(
    { method: "patch", path: "/roles/:id", summary: "Rename a role", tags, access: "roles.manage", params: IdParams, body: UpdateRoleSchema, responses: { 200: { description: "Updated", schema: RoleSchema } } },
    async ({ res, params, body }) => res.json(await service.renameRole(params.id, body.name)),
  );
  route(
    { method: "put", path: "/roles/:id/permissions", summary: "Replace a role's permissions (applies on the next request)", tags, access: "roles.manage", params: IdParams, body: SetRolePermissionsSchema, responses: { 200: { description: "Updated", schema: RoleSchema }, 409: { description: "SELF_LOCKOUT" } } },
    async ({ res, auth, params, body }) => res.json(await service.setRolePermissions(auth, params.id, body.permissions)),
  );
  route(
    { method: "post", path: "/roles/:id/archive", summary: "Archive a school role", tags, access: "roles.manage", params: IdParams, responses: { 204: { description: "Archived" } } },
    async ({ res, auth, params }) => {
      await service.archiveRole(auth, params.id);
      res.status(204).end();
    },
  );
}
