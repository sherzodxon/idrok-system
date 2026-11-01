import type { Router } from "express";
import { z } from "zod";
import {
  AssignPlanSchema,
  CreateCurriculumPlanSchema,
  ImportJobSchema,
  PlanAssignmentSchema,
  PlanImportOptionsSchema,
  PlanTemplateQuerySchema,
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
import { parse } from "../../http/validate";
import { XLSX } from "../imports/imports.processor";
import { jsonField, receiveUpload } from "../imports/imports.routes";
import { ImportsService } from "../imports/imports.service";
import type { OpenApiRegistry } from "../../openapi/registry";
import { CurriculumService } from "./curriculum.service";

const tags = ["curriculum"];

export function curriculumRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new CurriculumService(deps.db);
  const imports = new ImportsService(deps.db, deps.storage);
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
  // Registered before /curriculum-plans/:id, which would otherwise match "template".
  route(
    {
      method: "get",
      path: "/curriculum-plans/template",
      summary: "Plan template (.xlsx): ROWS = one row per lesson of a group, TOPICS = topics only",
      tags,
      access: "curriculum.export",
      query: PlanTemplateQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, query }) => {
      const buffer = await s.template(query);
      res.setHeader("Content-Type", XLSX);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="reja-${query.mode.toLowerCase()}-${query.locale}.xlsx"`,
      );
      res.send(buffer);
    },
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

  // ---- Excel import (§4.3)
  route(
    {
      method: "post",
      path: "/curriculum-plans/import",
      summary:
        "Upload a filled template (multipart: options JSON, file) → import job with a preview; commit creates a DRAFT",
      tags,
      access: "curriculum.create",
      responses: { 202: { description: "Accepted", schema: ImportJobSchema } },
    },
    async ({ req, res, auth }) => {
      const file = await receiveUpload(req, res);
      const { options } = parse(z.object({ options: jsonField(PlanImportOptionsSchema) }), req.body ?? {});
      await s.checkImport(auth, options);
      res.status(202).json(await imports.upload(auth, { kind: "CURRICULUM_PLAN", options, file }));
    },
  );

  // ---- applying to groups (§4.1, §4.4)
  route(
    {
      method: "get",
      path: "/curriculum-plans/:id/assignments",
      summary: "Groups the plan is applied to, with placement figures",
      tags,
      access: "curriculum.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Assignments", schema: z.array(PlanAssignmentSchema) } },
    },
    async ({ res, params }) => res.json(await s.listAssignments(params.id)),
  );
  route(
    {
      method: "post",
      path: "/curriculum-plans/:id/assignments",
      summary: "Apply an approved plan to groups (teachers: their own groups); topics are placed on the lessons",
      tags,
      access: "curriculum.create",
      params: IdParamsSchema,
      body: AssignPlanSchema,
      responses: { 200: { description: "Assignments", schema: z.array(PlanAssignmentSchema) } },
    },
    async ({ res, auth, params, body }) => res.json(await s.assign(auth, params.id, body.teachingGroupIds)),
  );
  route(
    {
      method: "delete",
      path: "/plan-assignments/:id",
      summary: "Stop applying a plan to a group (future topics are cleared)",
      tags,
      access: "curriculum.create",
      params: IdParamsSchema,
      responses: { 204: { description: "Removed" } },
    },
    async ({ res, auth, params }) => {
      await s.removeAssignment(auth, params.id);
      res.status(204).end();
    },
  );
}
