import type { Router } from "express";
import { z } from "zod";
import {
  IdParamsSchema,
  LessonGenerationApplySchema,
  LessonGenerationPreviewSchema,
  LessonGenerationRequestSchema,
  LessonGenerationResultSchema,
  LessonSessionQuerySchema,
  LessonSessionSchema,
  SetSubstituteSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { LessonGenerationService } from "./generation.service";
import { LessonsService } from "./lessons.service";

const tags = ["lessons"];

export function lessonRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const generation = new LessonGenerationService(deps.db);
  const lessons = new LessonsService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "post",
      path: "/academic-years/:id/lesson-generation/preview",
      summary: "What applying the timetable and calendar would change (add / update / cancel / blocked)",
      tags,
      access: "timetable.publish",
      params: IdParamsSchema,
      body: LessonGenerationRequestSchema,
      responses: { 200: { description: "Preview", schema: LessonGenerationPreviewSchema } },
    },
    async ({ res, params, body }) => res.json(await generation.preview(params.id, body.includePast)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/lesson-generation/apply",
      summary: "Apply the previewed change (409 PREVIEW_STALE if anything changed since)",
      tags,
      access: "timetable.publish",
      params: IdParamsSchema,
      body: LessonGenerationApplySchema,
      responses: { 200: { description: "Applied", schema: LessonGenerationResultSchema } },
    },
    async ({ res, params, body }) => res.json(await generation.apply(params.id, body.includePast, body.previewHash)),
  );
  route(
    {
      method: "get",
      path: "/lesson-sessions",
      summary: "Lessons in a date range (teachers: their own, substituted and their groups')",
      tags,
      access: "lessons.view",
      query: LessonSessionQuerySchema,
      responses: { 200: { description: "Lessons", schema: z.array(LessonSessionSchema) } },
    },
    async ({ res, auth, query }) => res.json(await lessons.list(auth, query)),
  );
  route(
    {
      method: "put",
      path: "/lesson-sessions/:id/substitute",
      summary: "Set or clear the substitute teacher of a lesson",
      tags,
      access: "timetable.manage",
      params: IdParamsSchema,
      body: SetSubstituteSchema,
      responses: { 200: { description: "Lesson", schema: LessonSessionSchema } },
    },
    async ({ res, params, body }) => res.json(await lessons.setSubstitute(params.id, body)),
  );
}
