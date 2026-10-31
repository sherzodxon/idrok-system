import type { Router } from "express";
import { z } from "zod";
import {
  BrandingSchema,
  BrandingUpdatedSchema,
  SchoolSettingsSchema,
  UpdateBrandingSchema,
  UpdateSchoolSettingsSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { SettingsService } from "./settings.service";

export function settingsRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new SettingsService(deps.db, deps.root);
  const route = routesFor(router, registry);
  const tags = ["settings"];

  route(
    {
      method: "get",
      path: "/branding",
      summary: "Public branding of a school (login page, CSS variables)",
      tags,
      access: "public",
      query: z.object({ tenant: z.string().trim().min(1).max(64).optional() }),
      responses: { 200: { description: "Branding", schema: BrandingSchema } },
    },
    async ({ res, query }) => {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(await service.publicBranding(query.tenant ?? deps.env.DEFAULT_TENANT_SLUG));
    },
  );
  route(
    { method: "get", path: "/settings/branding", summary: "Branding settings", tags, access: "settings.view", responses: { 200: { description: "Branding", schema: BrandingSchema } } },
    async ({ res }) => res.json(await service.branding()),
  );
  route(
    { method: "put", path: "/settings/branding", summary: "Change name, colours and default theme", tags, access: "branding.manage", body: UpdateBrandingSchema, responses: { 200: { description: "Saved, with contrast warnings", schema: BrandingUpdatedSchema } } },
    async ({ res, body }) => res.json(await service.updateBranding(body)),
  );
  route(
    { method: "get", path: "/settings/school", summary: "School settings", tags, access: "settings.view", responses: { 200: { description: "Settings", schema: SchoolSettingsSchema } } },
    async ({ res }) => res.json(await service.school()),
  );
  route(
    { method: "put", path: "/settings/school", summary: "Change school settings", tags, access: "settings.manage", body: UpdateSchoolSettingsSchema, responses: { 200: { description: "Saved", schema: SchoolSettingsSchema } } },
    async ({ res, auth, body }) => res.json(await service.updateSchool(auth.userId, body)),
  );
}
