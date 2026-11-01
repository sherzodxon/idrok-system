import type { Router } from "express";
import { z } from "zod";
import {
  CreateCurriculumPlanSchema,
  CreateTopicSchema,
  CurriculumPlanDetailSchema,
  CurriculumPlanListQuerySchema,
  CurriculumPlanSummarySchema,
  IdParamsSchema,
  RejectCurriculumPlanSchema,
  TopicQuerySchema,
  TopicSchema,
  UpdateCurriculumPlanSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { CurriculumService } from "./curriculum.service";

const tags = ["curriculum"];

export function curriculumRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new CurriculumService(deps.db);
  const route = routesFor(router, registry);
  const detail = { 200: { description: "Plan", schema: CurriculumPlanDetailSchema } };

  route(
    {
      method: "get",
      path: "/topics",
      summary: "Topics of a subject and grade",
      tags,
      access: "curriculum.view",
      query: TopicQuerySchema,
      responses: { 200: { description: "Topics", schema: z.array(TopicSchema) } },
    },
    async ({ res, query }) => res.json(await s.listTopics(query)),
  );
  route(
    {
      method: "post",
      path: "/topics",
      summary: "Create a topic (or return the one with the same title)",
      tags,
      access: "curriculum.create",
      body: CreateTopicSchema,
      responses: { 201: { description: "Topic", schema: TopicSchema } },
    },
    async ({ res, auth, body }) => res.status(201).json(await s.createTopic(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/curriculum-plans",
      summary: "Curriculum plans (archived versions only on request)",
      tags,
      access: "curriculum.view",
      query: CurriculumPlanListQuerySchema,
      responses: { 200: { description: "Plans", schema: pageOf(CurriculumPlanSummarySchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.list(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans",
      summary: "New plan (teachers: their own subjects and grades)",
      tags,
      access: "curriculum.create",
      body: CreateCurriculumPlanSchema,
      responses: { 201: detail[200] },
    },
    async ({ res, auth, body }) => res.status(201).json(await s.create(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/curriculum-plans/:id",
      summary: "Plan with items and versions",
      tags,
      access: "curriculum.view",
      params: IdParamsSchema,
      responses: detail,
    },
    async ({ res, auth, params }) => res.json(await s.get(auth, params.id)),
  );
  route(
    {
      method: "put",
      path: "/curriculum-plans/:id",
      summary: "Edit a DRAFT or REJECTED version (items are replaced)",
      tags,
      access: "curriculum.create",
      params: IdParamsSchema,
      body: UpdateCurriculumPlanSchema,
      responses: detail,
    },
    async ({ res, auth, params, body }) => res.json(await s.update(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans/:id/submit",
      summary: "Submit for approval (approved at once when the school does not require approval)",
      tags,
      access: "curriculum.create",
      params: IdParamsSchema,
      responses: detail,
    },
    async ({ res, auth, params }) => res.json(await s.submit(auth, params.id)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans/:id/approve",
      summary: "Approve a submitted version (the previous approved one is archived)",
      tags,
      access: "curriculum.approve",
      params: IdParamsSchema,
      responses: detail,
    },
    async ({ res, auth, params }) => res.json(await s.approve(auth, params.id)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans/:id/reject",
      summary: "Reject a submitted version with a note",
      tags,
      access: "curriculum.approve",
      params: IdParamsSchema,
      body: RejectCurriculumPlanSchema,
      responses: detail,
    },
    async ({ res, auth, params, body }) => res.json(await s.reject(auth, params.id, body.note)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans/:id/new-version",
      summary: "Start a new DRAFT version of an approved plan",
      tags,
      access: "curriculum.create",
      params: IdParamsSchema,
      responses: { 201: detail[200] },
    },
    async ({ res, auth, params }) => res.status(201).json(await s.newVersion(auth, params.id)),
  );
}
