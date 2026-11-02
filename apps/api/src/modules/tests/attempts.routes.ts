import type { Router } from "express";
import { z } from "zod";
import {
  AttemptEventResultSchema,
  AttemptEventSchema,
  AttemptViewSchema,
  CreateOverridesSchema,
  IdParamsSchema,
  ReopenAttemptSchema,
  SaveAnswerResultSchema,
  SaveAnswerSchema,
  SavePositionSchema,
  StudentTestSchema,
  TestAttemptSchema,
  TestOverrideSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { AttemptsService } from "./attempts.service";

const tags = ["tests"];
const VIEW = { anyOf: ["tests.create", "tests.results.view"] } as const;
const STUDENT = "portal.student";

// S4: every student response goes through its strict student schema — a key that is not in it (an answer key that
// slipped into a query) fails the request instead of reaching the student.
const studentView = AttemptViewSchema.parse.bind(AttemptViewSchema);

export function attemptRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new AttemptsService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/me/tests",
      summary: "The student's online tests with their state and own window (results only when allowed)",
      tags,
      access: STUDENT,
      responses: { 200: { description: "Tests", schema: z.array(StudentTestSchema) } },
    },
    async ({ res, auth }) => res.json(z.array(StudentTestSchema).parse(await s.myTests(auth))),
  );
  route(
    {
      method: "post",
      path: "/tests/:id/start",
      summary: "Start (or resume) an attempt: order and deadline are fixed by the server",
      tags,
      access: STUDENT,
      params: IdParamsSchema,
      responses: { 200: { description: "Attempt", schema: AttemptViewSchema } },
    },
    async ({ res, auth, params }) => res.json(studentView(await s.start(auth, params.id))),
  );
  route(
    {
      method: "get",
      path: "/attempts/:id",
      summary: "The attempt: questions without answers, saved answers, deadline and the server clock",
      tags,
      access: STUDENT,
      params: IdParamsSchema,
      responses: { 200: { description: "Attempt", schema: AttemptViewSchema } },
    },
    async ({ res, auth, params }) => res.json(studentView(await s.view(auth, params.id))),
  );
  route(
    {
      method: "put",
      path: "/attempts/:id/answers/:testQuestionId",
      summary: "Save one answer (ids only); an older clientSeq never overwrites a newer one",
      tags,
      access: STUDENT,
      params: z.object({ id: z.uuid(), testQuestionId: z.uuid() }),
      body: SaveAnswerSchema,
      responses: { 200: { description: "Saved", schema: SaveAnswerResultSchema } },
    },
    async ({ res, auth, params, body }) =>
      res.json(SaveAnswerResultSchema.parse(await s.saveAnswer(auth, params.id, params.testQuestionId, body))),
  );
  route(
    {
      method: "put",
      path: "/attempts/:id/position",
      summary: "Remember the question the student is on",
      tags,
      access: STUDENT,
      params: IdParamsSchema,
      body: SavePositionSchema,
      responses: { 204: { description: "Saved" } },
    },
    async ({ res, auth, params, body }) => {
      await s.savePosition(auth, params.id, body.currentIndex);
      res.status(204).end();
    },
  );
  route(
    {
      method: "post",
      path: "/attempts/:id/events",
      summary:
        "Page visibility / focus event; the server decides whether it counts and ends the attempt at the threshold",
      tags,
      access: STUDENT,
      params: IdParamsSchema,
      body: AttemptEventSchema,
      responses: { 200: { description: "Counted", schema: AttemptEventResultSchema } },
    },
    async ({ res, auth, params, body }) =>
      res.json(AttemptEventResultSchema.parse(await s.event(auth, params.id, body))),
  );
  route(
    {
      method: "post",
      path: "/attempts/:id/submit",
      summary: "Submit; the finish reason is the server's (TIME_UP past the deadline), anything sent is ignored",
      tags,
      access: STUDENT,
      params: IdParamsSchema,
      // §4.4: a client-sent finishReason is not an error, it is simply not read.
      body: z.object({}),
      responses: { 200: { description: "Attempt", schema: AttemptViewSchema } },
    },
    async ({ res, auth, params }) => res.json(studentView(await s.submit(auth, params.id))),
  );
  route(
    {
      method: "get",
      path: "/attempts/:id/images/:assetId",
      summary: "An image of a question in the student's own attempt",
      tags,
      access: STUDENT,
      params: z.object({ id: z.uuid(), assetId: z.uuid() }),
      responses: { 200: { description: "Image" } },
    },
    async ({ res, auth, params }) => {
      const asset = await s.image(auth, params.id, params.assetId);
      res.setHeader("Content-Type", asset.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(await deps.storage.get(asset.storageKey));
    },
  );

  // ---- teacher / admin
  route(
    {
      method: "get",
      path: "/tests/:id/attempts",
      summary: "Attempts of a test (finishes those past their deadline first)",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Attempts", schema: z.array(TestAttemptSchema) } },
    },
    async ({ res, auth, params }) => res.json(await s.attempts(auth, params.id)),
  );
  route(
    {
      method: "post",
      path: "/attempts/:id/reopen",
      summary: "Reopen a finished attempt with a new deadline (answers kept; reason and audit)",
      tags,
      access: "tests.reopen",
      params: IdParamsSchema,
      body: ReopenAttemptSchema,
      responses: { 200: { description: "Attempt", schema: TestAttemptSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await s.reopen(auth, params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/tests/:id/overrides",
      summary: "Retake / individual windows of a test",
      tags,
      access: VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Overrides", schema: z.array(TestOverrideSchema) } },
    },
    async ({ res, auth, params }) => res.json(await s.overrides(auth, params.id)),
  );
  route(
    {
      method: "post",
      path: "/tests/:id/overrides",
      summary: "Give students a retake or an individual window (reason required)",
      tags,
      access: "tests.reopen",
      params: IdParamsSchema,
      body: CreateOverridesSchema,
      responses: { 201: { description: "Overrides", schema: z.array(TestOverrideSchema) } },
    },
    async ({ res, auth, params, body }) => res.status(201).json(await s.addOverrides(auth, params.id, body)),
  );
}
