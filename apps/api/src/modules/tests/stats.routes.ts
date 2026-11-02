import type { Router } from "express";
import { z } from "zod";
import {
  GroupTopicMasteryQuerySchema,
  IdParamsSchema,
  QuestionStatsSchema,
  TestHistoryItemSchema,
  TestStatsSchema,
  TopicMasteryQuerySchema,
  TopicMasterySchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { XLSX } from "../imports/imports.processor";
import { StatsService } from "./stats.service";

const tags = ["tests"];
const VIEW = { anyOf: ["tests.create", "tests.results.view"] } as const;
/** A student's own data: staff by scope, the student, their guardians. */
const STUDENT_DATA = { anyOf: ["tests.results.view", "portal.student", "portal.guardian"] } as const;

export function statsRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new StatsService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/tests/:id/stats",
      summary: "Test statistics: summary, distribution, finish reasons, groups, the previous test, per student",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Stats", schema: TestStatsSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.testStats(auth, params.id)),
  );
  route(
    {
      method: "get",
      path: "/tests/:id/questions-stats",
      summary: "Per question: correct share and how often each option was chosen",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Questions", schema: z.array(QuestionStatsSchema) } },
    },
    async ({ res, auth, params }) => res.json(await s.questionStats(auth, params.id)),
  );
  route(
    {
      method: "get",
      path: "/tests/:id/results/export",
      summary: "Results and question statistics (.xlsx)",
      tags,
      access: "tests.results.view",
      params: IdParamsSchema,
      query: z.object({ locale: z.enum(["uz", "ru"]).default("uz") }),
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, auth, params, query }) => {
      const buffer = await s.exportResults(auth, params.id, query.locale);
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="test-${params.id.slice(0, 8)}.xlsx"`);
      res.send(buffer);
    },
  );
  route(
    {
      method: "get",
      path: "/students/:id/topic-mastery",
      summary: "Student × topic mastery over finished online tests (weakest first)",
      tags,
      access: STUDENT_DATA,
      params: IdParamsSchema,
      query: TopicMasteryQuerySchema,
      responses: { 200: { description: "Topics", schema: z.array(TopicMasterySchema) } },
    },
    async ({ res, auth, params, query }) => res.json(await s.studentMastery(auth, params.id, query.subjectId)),
  );
  route(
    {
      method: "get",
      path: "/topic-mastery",
      summary: "A group's topic mastery in a subject: the hardest topics first",
      tags,
      access: VIEW,
      query: GroupTopicMasteryQuerySchema,
      responses: { 200: { description: "Topics", schema: z.array(TopicMasterySchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.groupMastery(auth, query.teachingGroupId, query.subjectId)),
  );
  route(
    {
      method: "get",
      path: "/students/:id/test-history",
      summary: "A student's tests with the counted result (portal users see it only when the test allows)",
      tags,
      access: STUDENT_DATA,
      params: IdParamsSchema,
      responses: { 200: { description: "History", schema: z.array(TestHistoryItemSchema) } },
    },
    async ({ res, auth, params }) => res.json(z.array(TestHistoryItemSchema).parse(await s.history(auth, params.id))),
  );
}
