import type { Router } from "express";
import { z } from "zod";
import {
  CreateTimetableSchema,
  IdParamsSchema,
  PublishTimetableSchema,
  ReplaceTimetableEntriesSchema,
  TimetableDetailSchema,
  TimetableSummarySchema,
  TimetableViewQuerySchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { TimetableService } from "./timetable.service";

const tags = ["timetable"];

export function timetableRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new TimetableService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/academic-years/:id/timetables",
      summary: "Timetable versions of a year",
      tags,
      access: "timetable.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Versions", schema: z.array(TimetableSummarySchema) } },
    },
    async ({ res, params }) => res.json(await s.list(params.id)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/timetables",
      summary: "New DRAFT version (optionally a copy of another)",
      tags,
      access: "timetable.manage",
      params: IdParamsSchema,
      body: CreateTimetableSchema,
      responses: { 201: { description: "Created", schema: TimetableSummarySchema } },
    },
    async ({ res, params, body, auth }) => res.status(201).json(await s.create(params.id, body, auth.userId)),
  );
  route(
    {
      method: "get",
      path: "/timetables/:id",
      summary: "Entries with conflicts (?view=class|teacher|room&id=)",
      tags,
      access: "timetable.view",
      params: IdParamsSchema,
      query: TimetableViewQuerySchema,
      responses: { 200: { description: "Timetable", schema: TimetableDetailSchema } },
    },
    async ({ res, params, query }) => res.json(await s.get(params.id, query)),
  );
  route(
    {
      method: "put",
      path: "/timetables/:id/entries",
      summary: "Replace all entries of a DRAFT; returns conflicts",
      tags,
      access: "timetable.manage",
      params: IdParamsSchema,
      body: ReplaceTimetableEntriesSchema,
      responses: { 200: { description: "Timetable", schema: TimetableDetailSchema } },
    },
    async ({ res, params, body }) => res.json(await s.replaceEntries(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/timetables/:id/publish",
      summary: "Publish from a date; the previous version ends the day before",
      tags,
      access: "timetable.publish",
      params: IdParamsSchema,
      body: PublishTimetableSchema,
      responses: { 200: { description: "Published", schema: TimetableSummarySchema } },
    },
    async ({ res, params, body, auth }) => res.json(await s.publish(params.id, body, auth.userId)),
  );
  route(
    {
      method: "delete",
      path: "/timetables/:id",
      summary: "Delete a DRAFT version",
      tags,
      access: "timetable.manage",
      params: IdParamsSchema,
      responses: { 204: { description: "Deleted" } },
    },
    async ({ res, params }) => {
      await s.remove(params.id);
      res.status(204).end();
    },
  );
}
