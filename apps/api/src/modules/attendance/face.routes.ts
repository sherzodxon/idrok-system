import type { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  FaceProfilePageSchema,
  FaceProfileQuerySchema,
  FaceProfileSchema,
  IdParamsSchema,
  SchoolDateSchema,
} from "@idrok/shared";
import { atSchoolTime, diffSchoolDays, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import type { AppDeps } from "../../deps";
import { AppError, notFound } from "../../http/errors";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { cipherFor } from "./attendance.routes";
import { enqueueDeviceJob } from "./device-jobs";
import { FaceService } from "./face.service";

const tags = ["attendance"];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 } });

async function receivePhoto(req: Request, res: Response): Promise<Express.Multer.File> {
  await new Promise<void>((resolve, reject) =>
    upload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError)
        reject(new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: err.code.toLowerCase() }] }));
      else if (err) reject(err instanceof Error ? err : new Error("upload"));
      else resolve();
    }),
  );
  if (!req.file) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "required" }] });
  return req.file;
}

const HistorySchema = z
  .object({ from: SchoolDateSchema, to: SchoolDateSchema })
  .strict()
  .refine((r) => diffSchoolDays(r.from, r.to) >= 0 && diffSchoolDays(r.from, r.to) <= 7, {
    message: "range",
    path: ["to"],
  });

/** "+05:00": the school time zone's offset on a day (terminals take local times with an offset). */
function offsetOf(day: SchoolDate, tz: string): string {
  const minutes = Math.round((schoolDateToDb(day).getTime() - atSchoolTime(day, 0, tz).getTime()) / 60_000);
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function faceRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const faces = new FaceService(deps.db, deps.storage, cipherFor(deps));
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/face/profiles",
      summary: "Face Check: active students, their face photo and its state on every terminal",
      tags,
      access: "face.manage",
      query: FaceProfileQuerySchema,
      responses: { 200: { description: "Profiles", schema: FaceProfilePageSchema } },
    },
    async ({ res, query }) => res.json(await faces.list(query)),
  );
  route(
    {
      method: "get",
      path: "/face/students/:id",
      summary: "One student's face state",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Profile", schema: FaceProfileSchema } },
    },
    async ({ res, params }) => res.json(await faces.profile(params.id)),
  );
  route(
    {
      method: "put",
      path: "/face/students/:id/photo",
      summary: "Set the face photo (multipart file: JPEG, PNG or WebP up to 10 MB; stored as an encrypted JPEG)",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Profile", schema: FaceProfileSchema } },
    },
    async ({ req, res, auth, params }) => res.json(await faces.setPhoto(auth, params.id, await receivePhoto(req, res))),
  );
  route(
    {
      method: "get",
      path: "/face/students/:id/photo",
      summary: "The face photo on the server (JPEG)",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "JPEG" } },
    },
    async ({ res, params }) => {
      res.setHeader("Cache-Control", "no-store");
      res.type("image/jpeg").send(await faces.photo(params.id));
    },
  );
  route(
    {
      method: "delete",
      path: "/face/students/:id/photo",
      summary: "Remove the face photo here and from every terminal",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Profile", schema: FaceProfileSchema } },
    },
    async ({ res, params }) => res.json(await faces.removePhoto(params.id)),
  );
  route(
    {
      method: "post",
      path: "/face/students/:id/resync",
      summary: "Send the face again (all terminals, or one)",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      body: z.object({ deviceId: z.uuid().optional() }).strict(),
      responses: { 200: { description: "Profile", schema: FaceProfileSchema } },
    },
    async ({ res, params, body }) => res.json(await faces.resync(params.id, body.deviceId)),
  );
  route(
    {
      method: "post",
      path: "/face/students/:id/check",
      summary: "Ask the terminals whether they hold the face",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Profile", schema: FaceProfileSchema } },
    },
    async ({ res, params }) => res.json(await faces.check(params.id)),
  );

  // ---- device actions
  const device = async (id: string) => {
    const d = await deps.db.device.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, useBridge: true, bridgeAgentId: true },
    });
    if (!d) throw notFound();
    return d;
  };
  route(
    {
      method: "post",
      path: "/devices/:id/sync-faces",
      summary: "Send every active student's face to this terminal",
      tags,
      access: "face.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Queued", schema: z.object({ queued: z.number().int() }) } },
    },
    async ({ res, params }) => res.json(await faces.syncDevice(params.id)),
  );
  route(
    {
      method: "post",
      path: "/devices/:id/check",
      summary: "Read model, serial number and firmware from the terminal",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Queued", schema: z.object({ queued: z.number().int() }) } },
    },
    async ({ res, params }) => {
      const d = await device(params.id);
      await deps.db.$transaction(async (tx) => {
        await enqueueDeviceJob(tx, d, "DEVICE_INFO", {});
        await writeAudit(tx, { action: "device.check", entityType: "Device", entityId: d.id });
      });
      res.json({ queued: 1 });
    },
  );
  route(
    {
      method: "post",
      path: "/devices/:id/history",
      summary: "Read events of up to 8 days back from the terminal's log (after an outage)",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      body: HistorySchema,
      responses: { 200: { description: "Queued", schema: z.object({ queued: z.number().int() }) } },
    },
    async ({ res, params, body }) => {
      const d = await device(params.id);
      const { timezone } = await schoolClock(deps.db);
      const from = `${body.from}T00:00:00${offsetOf(body.from, timezone)}`;
      const to = `${body.to}T23:59:59${offsetOf(body.to, timezone)}`;
      await deps.db.$transaction(async (tx) => {
        await enqueueDeviceJob(tx, d, "EVENT_HISTORY", { from, to });
        await writeAudit(tx, { action: "device.history", entityType: "Device", entityId: d.id, after: body });
      });
      res.json({ queued: 1 });
    },
  );
}
