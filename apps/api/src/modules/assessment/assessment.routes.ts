import type { Router } from "express";
import { z } from "zod";
import {
  AssessmentConfigSchema,
  AssessmentPolicySchema,
  BindPolicySchema,
  ClosePeriodSchema,
  ManualScoreQuerySchema,
  ManualScoreSchema,
  MissingScoresQuerySchema,
  MissingScoresRowSchema,
  PeriodCloseRunSchema,
  RecomputePeriodSchema,
  SaveManualScoreSchema,
  GradebookQuerySchema,
  GradebookSchema,
  PeriodResultQuerySchema,
  PeriodResultSchema,
  ProgressQuerySchema,
  StudentProgressSchema,
  CreatePolicySchema,
  GradeScaleSchema,
  IdParamsSchema,
  PolicyBindingSchema,
  PolicyVersionSchema,
  SaveGradeScaleSchema,
  SavePolicyDraftSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { ClosingService } from "./closing.service";
import { PoliciesService } from "./policies.service";
import { ProgressService } from "./progress.service";

const tags = ["assessment"];
const VIEW = { anyOf: ["assessment.view", "assessment.manage"] } as const;

export function assessmentRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const policies = new PoliciesService(deps.db);
  const progress = new ProgressService(deps.db);
  const closing = new ClosingService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/periods/:id/close-runs",
      summary: "Prepare/close runs of a period, latest first",
      tags,
      access: { anyOf: ["assessment.approve", "assessment.view"] },
      params: IdParamsSchema,
      responses: { 200: { description: "Runs", schema: z.array(PeriodCloseRunSchema) } },
    },
    async ({ res, params }) => res.json(await closing.runs(params.id)),
  );
  route(
    {
      method: "post",
      path: "/periods/:id/prepare-close",
      summary: "Compute DRAFT results and the completeness report",
      tags,
      access: "assessment.approve",
      params: IdParamsSchema,
      responses: { 201: { description: "Prepared run", schema: PeriodCloseRunSchema } },
    },
    async ({ res, auth, params }) => res.status(201).json(await closing.prepare(params.id, auth.userId)),
  );
  route(
    {
      method: "post",
      path: "/periods/:id/close",
      summary: "Close the period: results become FINAL",
      tags,
      access: "assessment.approve",
      params: IdParamsSchema,
      body: ClosePeriodSchema,
      responses: { 200: { description: "Closed run", schema: PeriodCloseRunSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await closing.close(params.id, body.runId, auth.userId)),
  );
  route(
    {
      method: "post",
      path: "/periods/:id/recompute",
      summary: "New FINAL version of the stale results of a closed period",
      tags,
      access: "assessment.reopen",
      params: IdParamsSchema,
      body: RecomputePeriodSchema,
      responses: { 200: { description: "Count", schema: z.object({ recomputed: z.number().int() }) } },
    },
    async ({ res, auth, params, body }) => res.json(await closing.recompute(params.id, body.reason, auth.userId)),
  );
  route(
    {
      method: "get",
      path: "/manual-scores",
      summary: "Current manual component scores of a group and subject in a period",
      tags,
      access: { anyOf: ["assessment.manual_entry", "assessment.view"] },
      query: ManualScoreQuerySchema,
      responses: { 200: { description: "Scores", schema: z.array(ManualScoreSchema) } },
    },
    async ({ res, auth, query }) => res.json(await closing.listManual(auth, query)),
  );
  route(
    {
      method: "put",
      path: "/manual-scores",
      summary: "Enter or correct a manual component score (history kept)",
      tags,
      access: "assessment.manual_entry",
      body: SaveManualScoreSchema,
      responses: { 200: { description: "Score", schema: ManualScoreSchema } },
    },
    async ({ res, auth, body }) => res.json(await closing.saveManual(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/reports/missing-scores",
      summary: "Lessons over without any score or attendance, by teacher",
      tags,
      access: "assessment.view",
      query: MissingScoresQuerySchema,
      responses: { 200: { description: "Rows", schema: z.array(MissingScoresRowSchema) } },
    },
    async ({ res, query }) => res.json(await closing.missingScores(query)),
  );

  route(
    {
      method: "get",
      path: "/students/:id/progress",
      summary: "A student's percents by subject (and overall) for a day, week, month or period, with the entries",
      tags,
      access: { anyOf: ["gradebook.view", "portal.student", "portal.guardian"] },
      params: IdParamsSchema,
      query: ProgressQuerySchema,
      responses: { 200: { description: "Progress", schema: StudentProgressSchema } },
    },
    async ({ res, auth, params, query }) => res.json(await progress.progress(auth, params.id, query)),
  );
  route(
    {
      method: "get",
      path: "/gradebook",
      summary: "Students × lessons of a group, subject and period",
      tags,
      access: "gradebook.view",
      query: GradebookQuerySchema,
      responses: { 200: { description: "Gradebook", schema: GradebookSchema } },
    },
    async ({ res, auth, query }) => res.json(await progress.gradebook(auth, query)),
  );
  route(
    {
      method: "get",
      path: "/period-results",
      summary: "Period results of a group's students (live while open, FINAL once closed)",
      tags,
      access: "assessment.view",
      query: PeriodResultQuerySchema,
      responses: { 200: { description: "Results", schema: z.array(PeriodResultSchema) } },
    },
    async ({ res, auth, query }) => res.json(await progress.periodResults(auth, query)),
  );

  route(
    {
      method: "get",
      path: "/assessment/policies",
      summary: "Policies with their versions (the default preset is created on first use)",
      tags,
      access: VIEW,
      responses: { 200: { description: "Policies", schema: z.array(AssessmentPolicySchema) } },
    },
    async ({ res }) => res.json(await policies.list()),
  );
  route(
    {
      method: "post",
      path: "/assessment/policies",
      summary: "New policy; returns its first draft",
      tags,
      access: "assessment.manage",
      body: CreatePolicySchema,
      responses: { 201: { description: "Draft", schema: PolicyVersionSchema } },
    },
    async ({ res, auth, body }) => res.status(201).json(await policies.create(body, auth.userId)),
  );
  route(
    {
      method: "put",
      path: "/assessment/policies/:id/draft",
      summary: "Save the policy's draft version (a new version number when there is no draft)",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      body: SavePolicyDraftSchema,
      responses: { 200: { description: "Draft", schema: PolicyVersionSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await policies.saveDraft(params.id, body, auth.userId)),
  );
  route(
    {
      method: "post",
      path: "/assessment/policies/:id/default",
      summary: "Make the policy the default for newly activated periods",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      responses: { 204: { description: "Done" } },
    },
    async ({ res, params }) => {
      await policies.makeDefault(params.id);
      res.status(204).end();
    },
  );
  route(
    {
      method: "post",
      path: "/assessment/validate",
      summary: "Problems that would stop a config from being published (live check in the editor)",
      tags,
      access: "assessment.manage",
      body: AssessmentConfigSchema,
      responses: { 200: { description: "Problems", schema: z.object({ problems: z.array(z.string()) }) } },
    },
    async ({ res, body }) => res.json({ problems: await policies.problems(body) }),
  );
  route(
    {
      method: "get",
      path: "/assessment/versions/:id",
      summary: "One policy version with its config",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Version", schema: PolicyVersionSchema } },
    },
    async ({ res, params }) => res.json(await policies.getVersion(params.id)),
  );
  route(
    {
      method: "post",
      path: "/assessment/versions/:id/publish",
      summary: "Publish a draft (400 POLICY_INVALID with the problems)",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Published", schema: PolicyVersionSchema } },
    },
    async ({ res, auth, params }) => res.json(await policies.publish(params.id, auth.userId)),
  );
  route(
    {
      method: "get",
      path: "/periods/:id/policy-bindings",
      summary: "Policy bindings of a period, current first",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Bindings", schema: z.array(PolicyBindingSchema) } },
    },
    async ({ res, params }) => res.json(await policies.bindings(params.id)),
  );
  route(
    {
      method: "post",
      path: "/periods/:id/bind-policy",
      summary: "Bind a published version to the period (on an active period: apply now, with a reason)",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      body: BindPolicySchema,
      responses: { 201: { description: "Binding", schema: PolicyBindingSchema } },
    },
    async ({ res, auth, params, body }) => res.status(201).json(await policies.bind(params.id, body, auth.userId)),
  );
  route(
    {
      method: "get",
      path: "/grade-scales",
      summary: "Grade scales and their bands",
      tags,
      access: VIEW,
      responses: { 200: { description: "Scales", schema: z.array(GradeScaleSchema) } },
    },
    async ({ res }) => res.json(await policies.scales()),
  );
  route(
    {
      method: "post",
      path: "/grade-scales",
      summary: "New grade scale (bands cover 0–100 with no gap)",
      tags,
      access: "assessment.manage",
      body: SaveGradeScaleSchema,
      responses: { 201: { description: "Scale", schema: GradeScaleSchema } },
    },
    async ({ res, body }) => res.status(201).json(await policies.saveScale(null, body)),
  );
  route(
    {
      method: "put",
      path: "/grade-scales/:id",
      summary: "Change a scale (409 SCALE_IN_USE for the bands of a scale a published policy uses)",
      tags,
      access: "assessment.manage",
      params: IdParamsSchema,
      body: SaveGradeScaleSchema,
      responses: { 200: { description: "Scale", schema: GradeScaleSchema } },
    },
    async ({ res, params, body }) => res.json(await policies.saveScale(params.id, body)),
  );
}
