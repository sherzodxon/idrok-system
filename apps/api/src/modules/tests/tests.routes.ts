import type { Router } from "express";
import { z } from "zod";
import {
  CreateTestSchema,
  IdParamsSchema,
  SetTestQuestionsSchema,
  TestDetailSchema,
  TestListQuerySchema,
  TestProblemSchema,
  TestSchema,
  UpdateTestSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { TestsService } from "./tests.service";

const tags = ["tests"];
const VIEW = { anyOf: ["tests.create", "tests.results.view"] } as const;

export function testRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new TestsService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/tests",
      summary: "Tests: a teacher's own, every test for school-wide roles",
      tags,
      access: VIEW,
      query: TestListQuerySchema,
      responses: { 200: { description: "Page", schema: pageOf(TestSchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.list(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/tests",
      summary: "Create a DRAFT test (online or offline, practice or weighted)",
      tags,
      access: "tests.create",
      body: CreateTestSchema,
      responses: { 201: { description: "Created", schema: TestDetailSchema } },
    },
    async ({ res, auth, body }) => res.status(201).json(await s.create(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/tests/:id",
      summary: "A test with its questions (teacher view, with the answer key)",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Test", schema: TestDetailSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.get(auth, params.id)),
  );
  route(
    {
      method: "patch",
      path: "/tests/:id",
      summary: "Edit a DRAFT; after publishing only the title and the window (applyToRunning moves running deadlines)",
      tags,
      access: "tests.create",
      params: IdParamsSchema,
      body: UpdateTestSchema,
      responses: { 200: { description: "Test", schema: TestDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await s.update(auth, params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/tests/:id",
      summary: "Delete a DRAFT or archive a CLOSED test",
      tags,
      access: "tests.create",
      params: IdParamsSchema,
      responses: { 204: { description: "Done" } },
    },
    async ({ res, auth, params }) => {
      await s.remove(auth, params.id);
      res.status(204).end();
    },
  );
  route(
    {
      method: "put",
      path: "/tests/:id/questions",
      summary: "Choose the questions of a DRAFT by hand (in order)",
      tags,
      access: "tests.create",
      params: IdParamsSchema,
      body: SetTestQuestionsSchema,
      responses: { 200: { description: "Test", schema: TestDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await s.setQuestions(auth, params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/tests/:id/problems",
      summary: "What keeps the test from being published (empty = ready)",
      tags,
      access: "tests.create",
      params: IdParamsSchema,
      responses: { 200: { description: "Problems", schema: z.object({ problems: z.array(TestProblemSchema) }) } },
    },
    async ({ res, auth, params }) => res.json({ problems: await s.problems(auth, params.id) }),
  );
  route(
    {
      method: "post",
      path: "/tests/:id/publish",
      summary: "Check and publish: freezes the question versions; SCHEDULED or OPEN by the window",
      tags,
      access: "tests.publish",
      params: IdParamsSchema,
      responses: { 200: { description: "Test", schema: TestDetailSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.publish(auth, params.id)),
  );
  route(
    {
      method: "post",
      path: "/tests/:id/close",
      summary: "Close an open or scheduled test now",
      tags,
      access: "tests.publish",
      params: IdParamsSchema,
      responses: { 200: { description: "Test", schema: TestDetailSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.close(auth, params.id)),
  );
}
