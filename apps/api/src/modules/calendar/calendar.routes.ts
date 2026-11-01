import type { Router } from "express";
import { z } from "zod";
import {
  AcademicPeriodSchema,
  BellScheduleSchema,
  CalendarDayQuerySchema,
  CalendarDaySchema,
  CreateAcademicPeriodSchema,
  CreateBellScheduleSchema,
  CreateCalendarDaySchema,
  CreateCalendarRangeSchema,
  CreateRoomSchema,
  CreateShiftSchema,
  IdParamsSchema,
  RoomSchema,
  SchoolWeekSchema,
  ShiftSchema,
  UpdateAcademicPeriodSchema,
  UpdateBellScheduleSchema,
  UpdateCalendarDaySchema,
  UpdateRoomSchema,
  UpdateSchoolWeekSchema,
  UpdateShiftSchema,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { CalendarService } from "./calendar.service";

const tags = ["calendar"];
// Everyone who works with lessons may read the calendar; only calendar.manage changes it.
const READ = { anyOf: ["lessons.view", "calendar.manage"] } as const;

export function calendarRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new CalendarService(deps.db);
  const route = routesFor(router, registry);

  // ---- periods
  route(
    {
      method: "get",
      path: "/academic-years/:id/periods",
      summary: "Periods of a year (quarters, halves, year)",
      tags,
      access: READ,
      params: IdParamsSchema,
      responses: { 200: { description: "Periods", schema: z.array(AcademicPeriodSchema) } },
    },
    async ({ res, params }) => res.json(await s.listPeriods(params.id)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/periods",
      summary: "Create a period (same-type periods never overlap)",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: CreateAcademicPeriodSchema,
      responses: { 201: { description: "Created", schema: AcademicPeriodSchema } },
    },
    async ({ res, params, body }) => res.status(201).json(await s.createPeriod(params.id, body)),
  );
  route(
    {
      method: "patch",
      path: "/periods/:id",
      summary: "Rename; dates only while DRAFT",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: UpdateAcademicPeriodSchema,
      responses: { 200: { description: "Updated", schema: AcademicPeriodSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updatePeriod(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/periods/:id/activate",
      summary: "DRAFT → ACTIVE",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Activated", schema: AcademicPeriodSchema } },
    },
    async ({ res, params }) => res.json(await s.activatePeriod(params.id)),
  );

  // ---- school week
  route(
    {
      method: "get",
      path: "/academic-years/:id/school-week",
      summary: "Working weekdays (default Monday–Saturday)",
      tags,
      access: READ,
      params: IdParamsSchema,
      responses: { 200: { description: "Week", schema: SchoolWeekSchema } },
    },
    async ({ res, params }) => res.json(await s.schoolWeek(params.id)),
  );
  route(
    {
      method: "put",
      path: "/academic-years/:id/school-week",
      summary: "Set working weekdays",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: UpdateSchoolWeekSchema,
      responses: { 200: { description: "Week", schema: SchoolWeekSchema } },
    },
    async ({ res, params, body }) => res.json(await s.setSchoolWeek(params.id, body)),
  );

  // ---- calendar days
  route(
    {
      method: "get",
      path: "/academic-years/:id/calendar-days",
      summary: "Holidays, vacations and changed working days",
      tags,
      access: READ,
      params: IdParamsSchema,
      query: CalendarDayQuerySchema,
      responses: { 200: { description: "Days", schema: z.array(CalendarDaySchema) } },
    },
    async ({ res, params, query }) => res.json(await s.listDays(params.id, query)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/calendar-days",
      summary: "Mark one day ({ date }) or a range ({ from, to })",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: z.union([CreateCalendarDaySchema, CreateCalendarRangeSchema]),
      responses: { 201: { description: "Created days", schema: z.array(CalendarDaySchema) } },
    },
    async ({ res, params, body }) => res.status(201).json(await s.createDays(params.id, body)),
  );
  route(
    {
      method: "patch",
      path: "/calendar-days/:id",
      summary: "Change a marked day",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: UpdateCalendarDaySchema,
      responses: { 200: { description: "Updated", schema: CalendarDaySchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateDay(params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/calendar-days/:id",
      summary: "Unmark a day (audited; lessons follow after the regeneration review)",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      responses: { 204: { description: "Deleted" } },
    },
    async ({ res, params }) => {
      await s.deleteDay(params.id);
      res.status(204).end();
    },
  );

  // ---- shifts and rooms
  route(
    {
      method: "get",
      path: "/shifts",
      summary: "Shifts",
      tags,
      access: READ,
      responses: { 200: { description: "Shifts", schema: z.array(ShiftSchema) } },
    },
    async ({ res }) => res.json(await s.listShifts()),
  );
  route(
    {
      method: "post",
      path: "/shifts",
      summary: "Create a shift",
      tags,
      access: "calendar.manage",
      body: CreateShiftSchema,
      responses: { 201: { description: "Created", schema: ShiftSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createShift(body)),
  );
  route(
    {
      method: "patch",
      path: "/shifts/:id",
      summary: "Change or archive a shift",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: UpdateShiftSchema,
      responses: { 200: { description: "Updated", schema: ShiftSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateShift(params.id, body)),
  );
  route(
    {
      method: "get",
      path: "/rooms",
      summary: "Rooms",
      tags,
      access: { anyOf: ["timetable.view", "timetable.manage"] },
      responses: { 200: { description: "Rooms", schema: z.array(RoomSchema) } },
    },
    async ({ res }) => res.json(await s.listRooms()),
  );
  route(
    {
      method: "post",
      path: "/rooms",
      summary: "Create a room",
      tags,
      access: "timetable.manage",
      body: CreateRoomSchema,
      responses: { 201: { description: "Created", schema: RoomSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createRoom(body)),
  );
  route(
    {
      method: "patch",
      path: "/rooms/:id",
      summary: "Change or archive a room",
      tags,
      access: "timetable.manage",
      params: IdParamsSchema,
      body: UpdateRoomSchema,
      responses: { 200: { description: "Updated", schema: RoomSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateRoom(params.id, body)),
  );

  // ---- bell schedules
  route(
    {
      method: "get",
      path: "/academic-years/:id/bell-schedules",
      summary: "Bell schedules with slots",
      tags,
      access: READ,
      params: IdParamsSchema,
      responses: { 200: { description: "Schedules", schema: z.array(BellScheduleSchema) } },
    },
    async ({ res, params }) => res.json(await s.listBellSchedules(params.id)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/bell-schedules",
      summary: "Create a bell schedule (per shift, from a date)",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: CreateBellScheduleSchema,
      responses: { 201: { description: "Created", schema: BellScheduleSchema } },
    },
    async ({ res, params, body }) => res.status(201).json(await s.createBellSchedule(params.id, body)),
  );
  route(
    {
      method: "put",
      path: "/bell-schedules/:id",
      summary: "Change a bell schedule (slots are replaced)",
      tags,
      access: "calendar.manage",
      params: IdParamsSchema,
      body: UpdateBellScheduleSchema,
      responses: { 200: { description: "Updated", schema: BellScheduleSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateBellSchedule(params.id, body)),
  );
}
