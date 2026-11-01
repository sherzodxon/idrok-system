import type { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  CommitImportSchema,
  IdParamsSchema,
  ImportJobSchema,
  ImportKindSchema,
  ImportOptionsSchema,
  ImportRowSchema,
  ImportRowsQuerySchema,
  ListQuerySchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { AppError } from "../../http/errors";
import { routesFor } from "../../http/route";
import { parse } from "../../http/validate";
import type { OpenApiRegistry } from "../../openapi/registry";
import { buildTemplate } from "./excel";
import { XLSX } from "./imports.processor";
import { ImportsService, MAX_IMPORT_BYTES } from "./imports.service";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 5 } });

/** Reads a multipart upload (one .xlsx in "file"); also used by the curriculum plan import. */
export async function receiveUpload(req: Request, res: Response): Promise<Express.Multer.File> {
  await new Promise<void>((resolve, reject) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError)
        reject(new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: err.code.toLowerCase() }] }));
      else if (err) reject(err);
      else resolve();
    }),
  );
  if (!req.file) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "required" }] });
  return req.file;
}

/** JSON in a multipart text field. */
export const jsonField = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .max(2_000)
    .optional()
    .transform((v, ctx) => {
      if (!v) return {};
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid_json" });
        return z.NEVER;
      }
    })
    .pipe(schema);

// Teachers reach their own curriculum plan imports; everything else needs imports.run (checked in the service).
const JOB_ACCESS = { anyOf: ["imports.run", "curriculum.create"] } as const;

const UploadFieldsSchema = z.object({ kind: ImportKindSchema, options: jsonField(ImportOptionsSchema) });

const TemplateParams = z.object({ kind: ImportKindSchema });
const TemplateQuery = z.object({ locale: z.enum(["uz", "ru"]).default("uz") });

export function importsRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const service = new ImportsService(deps.db, deps.storage);
  const route = routesFor(router, registry);
  const tags = ["imports"];

  route(
    {
      method: "get",
      path: "/imports/templates/:kind",
      summary: "Excel template (headers in uz/ru, hidden key row)",
      tags,
      access: "imports.run",
      params: TemplateParams,
      query: TemplateQuery,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, params, query }) => {
      const buffer = await buildTemplate(params.kind, query.locale);
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="${params.kind.toLowerCase()}-${query.locale}.xlsx"`);
      res.send(buffer);
    },
  );

  route(
    {
      method: "post",
      path: "/imports",
      summary: "Upload an .xlsx (multipart: kind, options JSON, file); parsing runs in the worker",
      tags,
      access: "imports.run",
      responses: {
        202: { description: "Accepted", schema: ImportJobSchema },
        400: { description: "VALIDATION_ERROR" },
      },
    },
    async ({ req, res, auth }) => {
      const file = await receiveUpload(req, res);
      const fields = parse(UploadFieldsSchema, req.body ?? {});
      const job = await service.upload(auth, { kind: fields.kind, options: fields.options, file });
      res.status(202).json(job);
    },
  );

  route(
    {
      method: "get",
      path: "/imports",
      summary: "Import history",
      tags,
      access: "imports.run",
      query: ListQuerySchema,
      responses: { 200: { description: "Imports", schema: pageOf(ImportJobSchema) } },
    },
    async ({ res, query }) => res.json(await service.list(query)),
  );
  route(
    {
      method: "get",
      path: "/imports/:id",
      summary: "Import status and summary",
      tags,
      access: JOB_ACCESS,
      params: IdParamsSchema,
      responses: { 200: { description: "Import", schema: ImportJobSchema } },
    },
    async ({ res, auth, params }) => res.json(await service.get(params.id, auth)),
  );
  route(
    {
      method: "get",
      path: "/imports/:id/rows",
      summary: "Preview rows with their status and messages",
      tags,
      access: JOB_ACCESS,
      params: IdParamsSchema,
      query: ImportRowsQuerySchema,
      responses: { 200: { description: "Rows", schema: pageOf(ImportRowSchema) } },
    },
    async ({ res, auth, params, query }) => res.json(await service.rows(params.id, query, auth)),
  );
  route(
    {
      method: "post",
      path: "/imports/:id/commit",
      summary: "Apply the preview (once); the worker creates the records",
      tags,
      access: JOB_ACCESS,
      params: IdParamsSchema,
      body: CommitImportSchema,
      responses: {
        200: { description: "Committing", schema: ImportJobSchema },
        409: { description: "IMPORT_NOT_READY / IMPORT_HAS_ERRORS" },
      },
    },
    async ({ res, auth, params, body }) => res.json(await service.commit(auth, params.id, body.skipErrors)),
  );
  route(
    {
      method: "post",
      path: "/imports/:id/cancel",
      summary: "Cancel an import that was not applied",
      tags,
      access: JOB_ACCESS,
      params: IdParamsSchema,
      responses: { 200: { description: "Cancelled", schema: ImportJobSchema } },
    },
    async ({ res, auth, params }) => res.json(await service.cancel(params.id, auth)),
  );
  route(
    {
      method: "get",
      path: "/imports/:id/credentials",
      summary: "Logins and temporary passwords created by the import — downloadable once",
      tags,
      access: "imports.run",
      params: IdParamsSchema,
      responses: { 200: { description: ".xlsx" }, 409: { description: "CREDENTIALS_ALREADY_TAKEN" } },
    },
    async ({ res, auth, params }) => {
      const file = await service.takeCredentials(auth, params.id);
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(file.buffer);
    },
  );
}
