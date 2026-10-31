import type { Router } from "express";
import { MeSchema, PreferencesSchema, UpdatePreferencesSchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { defineRoute } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { MeService } from "./me.service";

export function meRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new MeService(deps.db);

  defineRoute(
    router,
    registry,
    {
      method: "get",
      path: "/me",
      summary: "Current user, roles, permissions and preferences",
      tags: ["me"],
      access: "authenticated",
      responses: { 200: { description: "Profile", schema: MeSchema } },
    },
    async ({ res, auth }) => res.json(await service.get(auth)),
  );

  defineRoute(
    router,
    registry,
    {
      method: "patch",
      path: "/me/preferences",
      summary: "Update theme, sidebar, density or language",
      tags: ["me"],
      access: "authenticated",
      body: UpdatePreferencesSchema,
      responses: { 200: { description: "Saved preferences", schema: PreferencesSchema } },
    },
    async ({ res, auth, body }) => res.json(await service.updatePreferences(auth.userId, body)),
  );
}
