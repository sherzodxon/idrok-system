import type { Router } from "express";
import { z } from "zod";
import {
  CreateScoreLimitRuleSchema,
  CreateScoresSchema,
  IdParamsSchema,
  LessonJournalSchema,
  ReverseScoreSchema,
  ScoreCriterionSchema,
  ScoreEntrySchema,
  ScoreLimitRuleSchema,
  ScoreQuerySchema,
  ScoreResultSchema,
  ScoreSettingsSchema,
  SetAttendanceSchema,
  UpdateScoreLimitRuleSchema,
  UpdateScoreSettingsSchema,
  UpsertScoreCriterionSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { ScoreConfigService } from "./score-config.service";
import { ScoresService } from "./scores.service";

const tags = ["scores"];
const CONFIG_VIEW = { anyOf: ["assessment.view", "assessment.manage", "scores.create"] } as const;

export function scoreRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const config = new ScoreConfigService(deps.db);
  const scores = new ScoresService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/score-criteria",
      summary: "Score criteria (inactive ones too for assessment managers)",
      tags,
      access: CONFIG_VIEW,
      responses: { 200: { description: "Criteria", schema: z.array(ScoreCriterionSchema) } },
    },
    async ({ res, auth }) => res.json(await config.listCriteria(!auth.permissions.includes("assessment.manage"))),
  );
  route(
    {
      method: "post",
      path: "/score-criteria",
      summary: "Add a score criterion",
      tags,
      access: "assessment.manage",
      body: UpsertScoreCriterionSchema,
      responses: { 201: { description: "Created", schema: ScoreCriterionSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createCriterion(body)),
  );
  route(
    {
      method: "patch",
      path: "/score-criteria/:id",
      summary: "Rename, reorder or deactivate a criterion",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      body: UpsertScoreCriterionSchema,
      responses: { 200: { description: "Criterion", schema: ScoreCriterionSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateCriterion(params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/score-settings",
      summary: "Caps, session maximum, late entry days",
      tags,
      access: CONFIG_VIEW,
      responses: { 200: { description: "Settings", schema: ScoreSettingsSchema } },
    },
    async ({ res }) => res.json(await config.getSettings()),
  );
  route(
    {
      method: "put",
      path: "/score-settings",
      summary: "Change the score settings",
      tags,
      access: "assessment.manage",
      body: UpdateScoreSettingsSchema,
      responses: { 200: { description: "Settings", schema: ScoreSettingsSchema } },
    },
    async ({ res, auth, body }) => res.json(await config.updateSettings(body, auth.userId)),
  );
  route(
    {
      method: "get",
      path: "/score-limit-rules",
      summary: "Limit rules",
      tags,
      access: { anyOf: ["assessment.view", "assessment.manage"] } as const,
      responses: { 200: { description: "Rules", schema: z.array(ScoreLimitRuleSchema) } },
    },
    async ({ res }) => res.json(await config.listRules()),
  );
  route(
    {
      method: "post",
      path: "/score-limit-rules",
      summary: "Add a limit rule (409 RULE_EXISTS when an active one has the same window and scope)",
      tags,
      access: "assessment.manage",
      body: CreateScoreLimitRuleSchema,
      responses: { 201: { description: "Created", schema: ScoreLimitRuleSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createRule(body)),
  );
  route(
    {
      method: "patch",
      path: "/score-limit-rules/:id",
      summary: "Change the maximum or (de)activate a rule",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      body: UpdateScoreLimitRuleSchema,
      responses: { 200: { description: "Rule", schema: ScoreLimitRuleSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateRule(params.id, body)),
  );

  route(
    {
      method: "get",
      path: "/lesson-sessions/:id/journal",
      summary: "Students, attendance, entries and remaining limits of one lesson",
      tags,
      access: "gradebook.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Journal", schema: LessonJournalSchema } },
    },
    async ({ res, auth, params }) => res.json(await scores.journal(auth, params.id)),
  );
  route(
    {
      method: "put",
      path: "/lesson-sessions/:id/attendance",
      summary: "Mark attendance of several students (the lesson becomes held)",
      tags,
      access: "lessons.mark",
      params: IdParamsSchema,
      body: SetAttendanceSchema,
      responses: { 200: { description: "Journal", schema: LessonJournalSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await scores.setAttendance(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/scores",
      summary: "One score (the entry) or a batch ({ entries }: a result per entry)",
      tags,
      access: "scores.create",
      body: CreateScoresSchema,
      responses: {
        201: { description: "Entry", schema: ScoreEntrySchema },
        200: { description: "Batch results", schema: z.array(ScoreResultSchema) },
      },
    },
    async ({ res, auth, body }) =>
      "entries" in body
        ? res.json(await scores.createMany(auth, body.entries))
        : res.status(201).json(await scores.create(auth, body)),
  );
  route(
    {
      method: "post",
      path: "/scores/:id/reverse",
      summary: "Reverse an entry (author within lateEntryDays; otherwise scores.correct and a reason)",
      tags,
      access: { anyOf: ["scores.create", "scores.correct"] } as const,
      params: IdParamsSchema,
      body: ReverseScoreSchema,
      responses: { 201: { description: "Reversal entry", schema: ScoreEntrySchema } },
    },
    async ({ res, auth, params, body }) => res.status(201).json(await scores.reverse(auth, params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/scores",
      summary: "A student's entries in a date range",
      tags,
      access: "gradebook.view",
      query: ScoreQuerySchema,
      responses: { 200: { description: "Entries", schema: z.array(ScoreEntrySchema) } },
    },
    async ({ res, auth, query }) => res.json(await scores.list(auth, query)),
  );
}
