import type { Router } from "express";
import { z } from "zod";
import {
  AssessmentConfigSchema,
  AssessmentPolicySchema,
  BindPolicySchema,
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
import { PoliciesService } from "./policies.service";

const tags = ["assessment"];
const VIEW = { anyOf: ["assessment.view", "assessment.manage"] } as const;

export function assessmentRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const policies = new PoliciesService(deps.db);
  const route = routesFor(router, registry);

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
