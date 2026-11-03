import type { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  CreateQuestionSchema,
  CreateTestTypeSchema,
  IdParamsSchema,
  ImportJobSchema,
  QuestionExportQuerySchema,
  QuestionImportOptionsSchema,
  QuestionListQuerySchema,
  QuestionSchema,
  QuestionVersionSchema,
  TestTypeSchema,
  UpdateQuestionSchema,
  UpdateTestTypeSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { AppError } from "../../http/errors";
import { routesFor } from "../../http/route";
import { parse } from "../../http/validate";
import type { OpenApiRegistry } from "../../openapi/registry";
import { jsonField, receiveUpload } from "../imports/imports.routes";
import { XLSX } from "../imports/imports.processor";
import { ImportsService } from "../imports/imports.service";
import { MAX_IMAGE_BYTES, QuestionBankService } from "./question-bank.service";
import { buildQuestionSheet } from "./question-excel";
import { TestTypesService } from "./test-types.service";

const tags = ["question-bank"];
/** Reading the bank: its owners, and teachers building tests from shared questions. */
const BANK_VIEW = { anyOf: ["questions.manage", "tests.create"] } as const;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2 },
});

export async function receiveImage(req: Request, res: Response): Promise<Express.Multer.File> {
  await new Promise<void>((resolve, reject) =>
    imageUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError)
        reject(new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: err.code.toLowerCase() }] }));
      else if (err) reject(err);
      else resolve();
    }),
  );
  if (!req.file) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "required" }] });
  return req.file;
}

export function questionBankRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new QuestionBankService(deps.db, deps.storage);
  const types = new TestTypesService(deps.db);
  const imports = new ImportsService(deps.db, deps.storage);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/question-bank/questions",
      summary: "Questions the caller may see (own; shared ones of their subjects), with the answer key",
      tags,
      access: BANK_VIEW,
      query: QuestionListQuerySchema,
      responses: { 200: { description: "Page", schema: pageOf(QuestionSchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.list(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/question-bank/questions",
      summary: "Add a question to the caller's bank (version 1)",
      tags,
      access: "questions.manage",
      body: CreateQuestionSchema,
      responses: { 201: { description: "Created", schema: QuestionSchema } },
    },
    async ({ res, auth, body }) => res.status(201).json(await s.create(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/question-bank/template",
      summary: "Empty question import template (.xlsx)",
      tags,
      access: "questions.manage",
      query: z.object({ locale: z.enum(["uz", "ru"]).default("uz") }),
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, query }) => {
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="savollar-${query.locale}.xlsx"`);
      res.send(await buildQuestionSheet(query.locale, []));
    },
  );
  route(
    {
      method: "get",
      path: "/question-bank/export",
      summary: "Questions with their answers (.xlsx): a teacher their own, school-wide roles all (S4)",
      tags,
      access: "questions.export",
      query: QuestionExportQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, auth, query }) => {
      const buffer = await s.export(auth, query);
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="savollar-${query.locale}.xlsx"`);
      res.send(buffer);
    },
  );
  route(
    {
      method: "post",
      path: "/question-bank/import",
      summary: "Upload a filled template (multipart: options JSON, file) → import job with a preview",
      tags,
      access: "questions.manage",
      responses: { 202: { description: "Accepted", schema: ImportJobSchema } },
    },
    async ({ req, res, auth }) => {
      const file = await receiveUpload(req, res);
      const { options } = parse(z.object({ options: jsonField(QuestionImportOptionsSchema) }), req.body ?? {});
      const [subject, grade] = await Promise.all([
        deps.db.subject.findFirst({ where: { id: options.subjectId } }),
        deps.db.grade.findFirst({ where: { id: options.gradeId } }),
      ]);
      if (!subject || !grade)
        throw new AppError("VALIDATION_ERROR", 400, {
          fields: [{ path: subject ? "gradeId" : "subjectId", code: "invalid" }],
        });
      if (!(await s.me(auth))) throw new AppError("FORBIDDEN", 403, { reason: "NO_EMPLOYEE_PROFILE" });
      res.status(202).json(await imports.upload(auth, { kind: "QUESTIONS", options, file }));
    },
  );
  route(
    {
      method: "post",
      path: "/question-bank/images",
      summary: "Upload a question image (multipart file: PNG, JPEG or WebP, up to 2 MB)",
      tags,
      access: "questions.manage",
      responses: { 201: { description: "Created", schema: z.object({ id: z.uuid() }) } },
    },
    async ({ req, res, auth }) => res.status(201).json(await s.uploadImage(auth, await receiveImage(req, res))),
  );
  route(
    {
      method: "get",
      path: "/question-bank/images/:id",
      summary: "A question image visible to the caller",
      tags,
      access: BANK_VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Image" } },
    },
    async ({ res, auth, params }) => {
      const img = await s.image(auth, params.id);
      res.setHeader("Content-Type", img.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(img.buffer);
    },
  );
  route(
    {
      method: "get",
      path: "/question-bank/questions/:id",
      summary: "One question with its current version",
      tags,
      access: BANK_VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Question", schema: QuestionSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.get(auth, params.id)),
  );
  route(
    {
      method: "patch",
      path: "/question-bank/questions/:id",
      summary: "Edit (owner only): content → a new version; topic, difficulty, sharing, archive in place",
      tags,
      access: "questions.manage",
      params: IdParamsSchema,
      body: UpdateQuestionSchema,
      responses: { 200: { description: "Question", schema: QuestionSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await s.update(auth, params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/question-bank/questions/:id/versions",
      summary: "All versions of a question, newest first",
      tags,
      access: BANK_VIEW,
      params: IdParamsSchema,
      responses: { 200: { description: "Versions", schema: z.array(QuestionVersionSchema) } },
    },
    async ({ res, auth, params }) => res.json(await s.versions(auth, params.id)),
  );

  // ---- test types (§1)
  route(
    {
      method: "get",
      path: "/test-types",
      summary: "Test types (inactive ones too for test_types.manage)",
      tags,
      access: { anyOf: ["tests.create", "tests.results.view", "test_types.manage"] },
      responses: { 200: { description: "Types", schema: z.array(TestTypeSchema) } },
    },
    async ({ res, auth }) => res.json(await types.list(auth.permissions.includes("test_types.manage"))),
  );
  route(
    {
      method: "post",
      path: "/test-types",
      summary: "Add a test type",
      tags,
      access: "test_types.manage",
      body: CreateTestTypeSchema,
      responses: { 201: { description: "Created", schema: TestTypeSchema } },
    },
    async ({ res, body }) => res.status(201).json(await types.create(body)),
  );
  route(
    {
      method: "patch",
      path: "/test-types/:id",
      summary: "Rename or deactivate a test type",
      tags,
      access: "test_types.manage",
      params: IdParamsSchema,
      body: UpdateTestTypeSchema,
      responses: { 200: { description: "Type", schema: TestTypeSchema } },
    },
    async ({ res, params, body }) => res.json(await types.update(params.id, body)),
  );
}
