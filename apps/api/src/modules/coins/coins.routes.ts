import type { Router } from "express";
import { z } from "zod";
import {
  CapacityQuerySchema,
  CoinAdjustmentSchema,
  CoinAutoRuleSchema,
  CoinCapacitySchema,
  CoinCriterionSchema,
  CoinLimitRuleSchema,
  CoinSettingsSchema,
  CoinStatusSchema,
  CoinSummarySchema,
  CoinTransactionQuerySchema,
  CoinTransactionSchema,
  CoinWriteResultSchema,
  CorrectCoinSchema,
  GiveCoinsSchema,
  IdParamsSchema,
  ReverseCoinSchema,
  SetCriterionTeachersSchema,
  TeacherCoinBoardSchema,
  UpdateCoinSettingsSchema,
  UpsertCoinAutoRuleSchema,
  UpsertCoinCriterionSchema,
  UpsertCoinLimitRuleSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { CoinConfigService } from "./coin-config.service";
import { CoinsService } from "./coins.service";

const tags = ["coins"];
/** Anyone who deals with coins — the status says which parts are switched on. */
const ANY_COINS = {
  anyOf: [
    "coins.view",
    "coins.give",
    "coins.settings.manage",
    "coin_shop.manage",
    "coin_orders.process",
    "portal.student",
    "portal.guardian",
  ],
} as const;
const CRITERIA_VIEW = { anyOf: ["coins.criteria.manage", "coins.view"] } as const;
const STUDENT_VIEW = { anyOf: ["coins.view", "coins.give", "portal.student", "portal.guardian"] } as const;
const Ok = z.object({ deleted: z.boolean() });

export function coinRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const config = new CoinConfigService(deps.db);
  const coins = new CoinsService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/coins/status",
      summary: "Which parts of the coin system are switched on",
      tags,
      access: ANY_COINS,
      responses: { 200: { description: "Status", schema: CoinStatusSchema } },
    },
    async ({ res }) => res.json(CoinStatusSchema.parse(await config.getSettings())),
  );
  route(
    {
      method: "get",
      path: "/coins/settings",
      summary: "Coin settings",
      tags,
      access: "coins.settings.manage",
      responses: { 200: { description: "Settings", schema: CoinSettingsSchema } },
    },
    async ({ res }) => res.json(await config.getSettings()),
  );
  route(
    {
      method: "put",
      path: "/coins/settings",
      summary: "Change coin settings",
      tags,
      access: "coins.settings.manage",
      body: UpdateCoinSettingsSchema,
      responses: { 200: { description: "Settings", schema: CoinSettingsSchema } },
    },
    async ({ res, auth, body }) => res.json(await config.updateSettings(auth.userId, body)),
  );

  // ---- criteria
  route(
    {
      method: "get",
      path: "/coins/criteria",
      summary: "All coin criteria (inactive too)",
      tags,
      access: CRITERIA_VIEW,
      responses: { 200: { description: "Criteria", schema: z.array(CoinCriterionSchema) } },
    },
    async ({ res }) => res.json(await config.listCriteria(false)),
  );
  route(
    {
      method: "post",
      path: "/coins/criteria",
      summary: "Add a criterion",
      tags,
      access: "coins.criteria.manage",
      body: UpsertCoinCriterionSchema,
      responses: { 201: { description: "Created", schema: CoinCriterionSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createCriterion(body)),
  );
  route(
    {
      method: "put",
      path: "/coins/criteria/:id",
      summary: "Change a criterion",
      tags,
      access: "coins.criteria.manage",
      params: IdParamsSchema,
      body: UpsertCoinCriterionSchema,
      responses: { 200: { description: "Criterion", schema: CoinCriterionSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateCriterion(params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/coins/criteria/:id",
      summary: "Delete an unused criterion, deactivate a used one",
      tags,
      access: "coins.criteria.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Result", schema: Ok } },
    },
    async ({ res, params }) => res.json(await config.deleteCriterion(params.id)),
  );
  route(
    {
      method: "put",
      path: "/coins/criteria/:id/teachers",
      summary: "Teachers allowed to use a criterion",
      tags,
      access: "coins.criteria.manage",
      params: IdParamsSchema,
      body: SetCriterionTeachersSchema,
      responses: { 200: { description: "Criterion", schema: CoinCriterionSchema } },
    },
    async ({ res, params, body }) => res.json(await config.setCriterionTeachers(params.id, body)),
  );

  // ---- limits
  route(
    {
      method: "get",
      path: "/coins/limits",
      summary: "Limit rules",
      tags,
      access: { anyOf: ["coins.limits.manage", "coins.view"] },
      responses: { 200: { description: "Rules", schema: z.array(CoinLimitRuleSchema) } },
    },
    async ({ res }) => res.json(await config.listLimits()),
  );
  route(
    {
      method: "post",
      path: "/coins/limits",
      summary: "Add a limit rule",
      tags,
      access: "coins.limits.manage",
      body: UpsertCoinLimitRuleSchema,
      responses: { 201: { description: "Created", schema: CoinLimitRuleSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createLimit(body)),
  );
  route(
    {
      method: "put",
      path: "/coins/limits/:id",
      summary: "Change a limit rule",
      tags,
      access: "coins.limits.manage",
      params: IdParamsSchema,
      body: UpsertCoinLimitRuleSchema,
      responses: { 200: { description: "Rule", schema: CoinLimitRuleSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateLimit(params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/coins/limits/:id",
      summary: "Deactivate a limit rule",
      tags,
      access: "coins.limits.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Rule", schema: CoinLimitRuleSchema } },
    },
    async ({ res, params }) => res.json(await config.deactivateLimit(params.id)),
  );

  // ---- automatic rules
  route(
    {
      method: "get",
      path: "/coins/auto-rules",
      summary: "Automatic coin rules",
      tags,
      access: "coins.settings.manage",
      responses: { 200: { description: "Rules", schema: z.array(CoinAutoRuleSchema) } },
    },
    async ({ res }) => res.json(await config.listAutoRules()),
  );
  route(
    {
      method: "post",
      path: "/coins/auto-rules",
      summary: "Add an automatic coin rule",
      tags,
      access: "coins.settings.manage",
      body: UpsertCoinAutoRuleSchema,
      responses: { 201: { description: "Created", schema: CoinAutoRuleSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createAutoRule(body)),
  );
  route(
    {
      method: "put",
      path: "/coins/auto-rules/:id",
      summary: "Change an automatic coin rule",
      tags,
      access: "coins.settings.manage",
      params: IdParamsSchema,
      body: UpsertCoinAutoRuleSchema,
      responses: { 200: { description: "Rule", schema: CoinAutoRuleSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateAutoRule(params.id, body)),
  );

  // ---- ledger
  route(
    {
      method: "post",
      path: "/coins/transactions",
      summary: "Evaluate a student by a criterion (teacher)",
      tags,
      access: "coins.give",
      body: GiveCoinsSchema,
      responses: { 200: { description: "Written (or the earlier result)", schema: CoinWriteResultSchema } },
    },
    async ({ res, auth, body }) => res.json(await coins.give(auth, body)),
  );
  route(
    {
      method: "post",
      path: "/coins/adjustments",
      summary: "Manual balance adjustment",
      tags,
      access: "coins.adjust",
      body: CoinAdjustmentSchema,
      responses: { 200: { description: "Written", schema: CoinWriteResultSchema } },
    },
    async ({ res, auth, body }) => res.json(await coins.adjust(auth, body)),
  );
  route(
    {
      method: "post",
      path: "/coins/transactions/:id/reverse",
      summary: "Undo a reward, penalty or adjustment",
      tags,
      access: { anyOf: ["coins.reverse", "coins.give"] },
      params: IdParamsSchema,
      body: ReverseCoinSchema,
      responses: { 200: { description: "Reversal", schema: CoinWriteResultSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await coins.reverse(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/coins/transactions/:id/correct",
      summary: "Lower an evaluation",
      tags,
      access: "coins.reverse",
      params: IdParamsSchema,
      body: CorrectCoinSchema,
      responses: { 200: { description: "Correction", schema: CoinWriteResultSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await coins.correct(auth, params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/coins/transactions",
      summary: "The coin ledger",
      tags,
      access: "coins.view",
      query: CoinTransactionQuerySchema,
      responses: { 200: { description: "Page", schema: pageOf(CoinTransactionSchema) } },
    },
    async ({ res, query }) => res.json(await coins.list(query)),
  );

  // ---- teacher
  route(
    {
      method: "get",
      path: "/coins/teacher/board",
      summary: "The teacher's groups, students with balances and usable criteria",
      tags,
      access: "coins.give",
      responses: { 200: { description: "Board", schema: TeacherCoinBoardSchema } },
    },
    async ({ res, auth }) => res.json(await coins.board(auth)),
  );
  route(
    {
      method: "get",
      path: "/coins/teacher/students/:id/capacity",
      summary: "What is left under the limits for this student and criterion",
      tags,
      access: "coins.give",
      params: IdParamsSchema,
      query: CapacityQuerySchema,
      responses: { 200: { description: "Capacity", schema: CoinCapacitySchema } },
    },
    async ({ res, auth, params, query }) => res.json(await coins.capacity(auth, params.id, query)),
  );
  route(
    {
      method: "get",
      path: "/coins/teacher/transactions",
      summary: "Evaluations the teacher gave",
      tags,
      access: "coins.give",
      query: CoinTransactionQuerySchema,
      responses: { 200: { description: "Page", schema: pageOf(CoinTransactionSchema) } },
    },
    async ({ res, auth, query }) => res.json(await coins.teacherHistory(auth, query)),
  );

  // ---- a student's coins (staff, teacher, self, guardian)
  route(
    {
      method: "get",
      path: "/coins/students/:id/summary",
      summary: "Balance and totals of a student",
      tags,
      access: STUDENT_VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Summary", schema: CoinSummarySchema } },
    },
    async ({ res, auth, params }) => res.json(await coins.summary(auth, params.id)),
  );
  route(
    {
      method: "get",
      path: "/coins/students/:id/transactions",
      summary: "Coin history of a student",
      tags,
      access: STUDENT_VIEW,
      params: IdParamsSchema,
      query: CoinTransactionQuerySchema,
      responses: { 200: { description: "Page", schema: pageOf(CoinTransactionSchema) } },
    },
    async ({ res, auth, params, query }) => res.json(await coins.studentHistory(auth, params.id, query)),
  );
}
