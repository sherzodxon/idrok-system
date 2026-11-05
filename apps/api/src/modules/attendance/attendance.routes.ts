import type { Router } from "express";
import { z } from "zod";
import {
  AccessEventQuerySchema,
  AccessEventSchema,
  AttendanceDayQuerySchema,
  AttendanceDaySchema,
  AttendanceFeatureSchema,
  AttendanceMonitoringSchema,
  AttendanceSummaryQuerySchema,
  AttendanceSummarySchema,
  AttendanceSettingsSchema,
  BridgeAgentSchema,
  BridgeTokenSchema,
  ClearManualMarkSchema,
  DeviceKeySchema,
  DeviceSchema,
  IdParamsSchema,
  LatenessBandSchema,
  ManualMarkParamsSchema,
  ManualMarkSchema,
  StudentAttendanceQuerySchema,
  StudentAttendanceSchema,
  UpdateAttendanceSettingsSchema,
  UpsertBridgeAgentSchema,
  UpsertDeviceSchema,
  UpsertLatenessBandSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import { DataCipher, parseEncryptionKey } from "../../infra/crypto";
import type { OpenApiRegistry } from "../../openapi/registry";
import { AttendanceConfigService, attendanceSettings } from "./attendance-config.service";
import { AttendanceService } from "./attendance.service";
import { DevicesService } from "./devices.service";

const tags = ["attendance"];
const Deleted = z.object({ deleted: z.boolean() });
const STUDENT_VIEW = { anyOf: ["attendance.view", "portal.student", "portal.guardian"] } as const;
const ANY_ATTENDANCE = {
  anyOf: [
    "attendance.view",
    "attendance.settings.manage",
    "devices.manage",
    "face.manage",
    "portal.student",
    "portal.guardian",
  ],
} as const;

export const cipherFor = (deps: AppDeps) => new DataCipher(parseEncryptionKey(deps.env.DATA_ENCRYPTION_KEY));

export function attendanceRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const cipher = cipherFor(deps);
  const config = new AttendanceConfigService(deps.db, cipher);
  const attendance = new AttendanceService(deps.db);
  const devices = new DevicesService(deps.db, cipher, deps.env.DEVICE_PUBLIC_API_URL);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/attendance/status",
      summary: "Whether school attendance (Face ID) is switched on",
      tags,
      access: ANY_ATTENDANCE,
      responses: { 200: { description: "Status", schema: AttendanceFeatureSchema } },
    },
    async ({ res }) => res.json({ isEnabled: (await attendanceSettings(deps.db)).isEnabled }),
  );
  route(
    {
      method: "get",
      path: "/attendance/settings",
      summary: "Attendance settings",
      tags,
      access: "attendance.settings.manage",
      responses: { 200: { description: "Settings", schema: AttendanceSettingsSchema } },
    },
    async ({ res }) => res.json(await config.getSettings()),
  );
  route(
    {
      method: "put",
      path: "/attendance/settings",
      summary: "Change attendance settings",
      tags,
      access: "attendance.settings.manage",
      body: UpdateAttendanceSettingsSchema,
      responses: { 200: { description: "Settings", schema: AttendanceSettingsSchema } },
    },
    async ({ res, body }) => res.json(await config.updateSettings(body)),
  );

  // ---- lateness bands
  route(
    {
      method: "get",
      path: "/attendance/lateness-bands",
      summary: "Lateness bands (archived too)",
      tags,
      access: { anyOf: ["attendance.settings.manage", "attendance.view", "coins.settings.manage"] },
      responses: { 200: { description: "Bands", schema: z.array(LatenessBandSchema) } },
    },
    async ({ res }) => res.json(await config.listBands()),
  );
  route(
    {
      method: "post",
      path: "/attendance/lateness-bands",
      summary: "Add a lateness band",
      tags,
      access: "attendance.settings.manage",
      body: UpsertLatenessBandSchema,
      responses: { 201: { description: "Created", schema: LatenessBandSchema } },
    },
    async ({ res, body }) => res.status(201).json(await config.createBand(body)),
  );
  route(
    {
      method: "put",
      path: "/attendance/lateness-bands/:id",
      summary: "Change a lateness band (a used band keeps its range)",
      tags,
      access: "attendance.settings.manage",
      params: IdParamsSchema,
      body: UpsertLatenessBandSchema,
      responses: { 200: { description: "Band", schema: LatenessBandSchema } },
    },
    async ({ res, params, body }) => res.json(await config.updateBand(params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/attendance/lateness-bands/:id",
      summary: "Delete an unused band, archive a used one",
      tags,
      access: "attendance.settings.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Done", schema: Deleted } },
    },
    async ({ res, params }) => res.json(await config.deleteBand(params.id)),
  );

  // ---- journal
  route(
    {
      method: "get",
      path: "/attendance/day",
      summary: "School attendance of a day: every expected student in scope",
      tags,
      access: "attendance.view",
      query: AttendanceDayQuerySchema,
      responses: { 200: { description: "Day", schema: AttendanceDaySchema } },
    },
    async ({ res, auth, query }) => res.json(await attendance.day(auth, query)),
  );
  route(
    {
      method: "get",
      path: "/attendance/summary",
      summary: "Dashboard: today's attendance by class and a short trend of past school days",
      tags,
      access: "attendance.view",
      query: AttendanceSummaryQuerySchema,
      responses: { 200: { description: "Summary", schema: AttendanceSummarySchema } },
    },
    async ({ res, auth, query }) => res.json(await attendance.summary(auth, query)),
  );
  route(
    {
      method: "get",
      path: "/attendance/students/:id",
      summary: "A student's school attendance (staff in scope, the student, their guardian)",
      tags,
      access: STUDENT_VIEW,
      params: IdParamsSchema,
      query: StudentAttendanceQuerySchema,
      responses: { 200: { description: "History", schema: StudentAttendanceSchema } },
    },
    async ({ res, auth, params, query }) => res.json(await attendance.student(auth, params.id, query)),
  );
  route(
    {
      method: "put",
      path: "/attendance/students/:id/days/:date",
      summary: "Mark a day by hand (the device result is kept beside it)",
      tags,
      access: "attendance.mark",
      params: ManualMarkParamsSchema,
      body: ManualMarkSchema,
      responses: { 200: { description: "Day", schema: StudentAttendanceSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await attendance.mark(auth, params.id, params.date, body)),
  );
  route(
    {
      method: "post",
      path: "/attendance/students/:id/days/:date/clear",
      summary: "Remove a manual mark (the device result applies again)",
      tags,
      access: "attendance.mark",
      params: ManualMarkParamsSchema,
      body: ClearManualMarkSchema,
      responses: { 200: { description: "Day", schema: StudentAttendanceSchema } },
    },
    async ({ res, auth, params, body }) =>
      res.json(await attendance.clearMark(auth, params.id, params.date, body.reason)),
  );

  // ---- monitoring
  route(
    {
      method: "get",
      path: "/attendance/events",
      summary: "Raw terminal events of a day",
      tags,
      access: { anyOf: ["devices.manage", "face.manage"] },
      query: AccessEventQuerySchema,
      responses: { 200: { description: "Events", schema: pageOf(AccessEventSchema) } },
    },
    async ({ res, query }) => res.json(await attendance.events(query)),
  );
  route(
    {
      method: "get",
      path: "/attendance/monitoring",
      summary: "Devices, bridges, events and face sync at a glance",
      tags,
      access: { anyOf: ["devices.manage", "face.manage", "attendance.settings.manage"] },
      responses: { 200: { description: "Monitoring", schema: AttendanceMonitoringSchema } },
    },
    async ({ res }) => res.json(await attendance.monitoring()),
  );

  // ---- devices
  route(
    {
      method: "get",
      path: "/devices",
      summary: "Face ID terminals",
      tags,
      access: "devices.manage",
      responses: { 200: { description: "Devices", schema: z.array(DeviceSchema) } },
    },
    async ({ res }) => res.json(await devices.listDevices()),
  );
  route(
    {
      method: "post",
      path: "/devices",
      summary: "Add a terminal; its webhook key is shown once",
      tags,
      access: "devices.manage",
      body: UpsertDeviceSchema,
      responses: { 201: { description: "Created", schema: DeviceKeySchema } },
    },
    async ({ res, body }) => res.status(201).json(await devices.createDevice(body)),
  );
  route(
    {
      method: "put",
      path: "/devices/:id",
      summary: "Change a terminal (password: omitted keeps it)",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      body: UpsertDeviceSchema,
      responses: { 200: { description: "Device", schema: DeviceSchema } },
    },
    async ({ res, params, body }) => res.json(await devices.updateDevice(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/devices/:id/rotate-key",
      summary: "New webhook key (the old one stops working)",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Key", schema: DeviceKeySchema } },
    },
    async ({ res, params }) => res.json(await devices.rotateDeviceKey(params.id)),
  );
  route(
    {
      method: "post",
      path: "/devices/:id/archive",
      summary: "Archive a terminal (its events stay)",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Device", schema: DeviceSchema } },
    },
    async ({ res, params }) => res.json(await devices.archiveDevice(params.id)),
  );

  // ---- bridge agents
  route(
    {
      method: "get",
      path: "/bridge-agents",
      summary: "Bridge agents",
      tags,
      access: "devices.manage",
      responses: { 200: { description: "Agents", schema: z.array(BridgeAgentSchema) } },
    },
    async ({ res }) => res.json(await devices.listBridges()),
  );
  route(
    {
      method: "post",
      path: "/bridge-agents",
      summary: "Add a bridge; its token is shown once",
      tags,
      access: "devices.manage",
      body: UpsertBridgeAgentSchema,
      responses: { 201: { description: "Created", schema: BridgeTokenSchema } },
    },
    async ({ res, body }) => res.status(201).json(await devices.createBridge(body)),
  );
  route(
    {
      method: "put",
      path: "/bridge-agents/:id",
      summary: "Rename or switch off a bridge",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      body: UpsertBridgeAgentSchema,
      responses: { 200: { description: "Agent", schema: BridgeAgentSchema } },
    },
    async ({ res, params, body }) => res.json(await devices.updateBridge(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/bridge-agents/:id/rotate-token",
      summary: "New bridge token (the old one stops working at once)",
      tags,
      access: "devices.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Token", schema: BridgeTokenSchema } },
    },
    async ({ res, params }) => res.json(await devices.rotateBridgeToken(params.id)),
  );
}
