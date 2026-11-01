// M2 step 1: academic periods, school week, calendar days, shifts, rooms and bell schedules (lesson-plan.md §2).
// Every change is audited in the same transaction. Lesson sessions are not touched here: after a calendar change the
// admin reviews the regeneration diff (step 3).
import type { z } from "zod";
import { Prisma, requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type {
  CreateAcademicPeriodSchema,
  CreateBellScheduleSchema,
  CreateCalendarDaySchema,
  CreateCalendarRangeSchema,
  CreateRoomSchema,
  CreateShiftSchema,
  UpdateAcademicPeriodSchema,
  UpdateBellScheduleSchema,
  UpdateCalendarDaySchema,
  UpdateRoomSchema,
  UpdateSchoolWeekSchema,
  UpdateShiftSchema,
} from "@idrok/shared";
import {
  eachSchoolDate,
  formatTimeOfDay,
  parseTimeOfDay,
  schoolDateFromDb,
  schoolDateToDb,
  type SchoolDate,
} from "@idrok/shared/time";
import { AppError, isConstraintError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";

/** Q-02 default until the school saves its own week. */
export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const MAX_RANGE_DAYS = 120;

const fieldError = (path: string, code: string) => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });
const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });

type Year = { id: string; startDate: Date; endDate: Date; status: string };

export class CalendarService {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------- helpers

  private async year(tx: DbTransaction | Db, id: string, forWrite = true): Promise<Year> {
    const year = await tx.academicYear.findUnique({ where: { id } });
    if (!year) throw notFound();
    if (forWrite && year.status === "ARCHIVED") throw conflict("YEAR_ARCHIVED");
    return year;
  }

  private inYear(year: Year, path: string, ...dates: SchoolDate[]) {
    const from = schoolDateFromDb(year.startDate);
    const to = schoolDateFromDb(year.endDate);
    if (dates.some((d) => d < from || d > to)) throw fieldError(path, "outside_academic_year");
  }

  // ---------------------------------------------------------------- periods

  private periodDto(p: {
    id: string;
    academicYearId: string;
    type: string;
    name: string;
    order: number;
    startDate: Date;
    endDate: Date;
    parentId: string | null;
    status: string;
  }) {
    return {
      id: p.id,
      academicYearId: p.academicYearId,
      type: p.type as "QUARTER" | "HALF" | "YEAR" | "CUSTOM",
      name: p.name,
      order: p.order,
      startDate: schoolDateFromDb(p.startDate),
      endDate: schoolDateFromDb(p.endDate),
      parentId: p.parentId,
      status: p.status as "DRAFT" | "ACTIVE" | "CLOSED",
    };
  }

  async listPeriods(academicYearId: string) {
    await this.year(this.db, academicYearId, false);
    const periods = await this.db.academicPeriod.findMany({
      where: { academicYearId },
      orderBy: [{ startDate: "asc" }, { type: "asc" }],
    });
    return periods.map((p) => this.periodDto(p));
  }

  /** A parent must be a larger period of the same year that contains the child's dates. */
  private async checkParent(tx: DbTransaction, yearId: string, parentId: string, from: SchoolDate, to: SchoolDate) {
    const parent = await tx.academicPeriod.findUnique({ where: { id: parentId } });
    if (!parent || parent.academicYearId !== yearId) throw fieldError("parentId", "invalid");
    if (schoolDateFromDb(parent.startDate) > from || schoolDateFromDb(parent.endDate) < to)
      throw fieldError("parentId", "outside_parent");
  }

  private async savePeriod<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isConstraintError(err, "AcademicPeriod_no_overlap")) throw conflict("PERIOD_OVERLAP");
      // The only unique key besides the id: (year, type, order).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        throw conflict("PERIOD_ORDER_TAKEN");
      throw err;
    }
  }

  async createPeriod(academicYearId: string, input: z.infer<typeof CreateAcademicPeriodSchema>) {
    return this.savePeriod(() =>
      this.db.$transaction(async (tx) => {
        const year = await this.year(tx, academicYearId);
        this.inYear(year, "startDate", input.startDate, input.endDate);
        if (input.parentId) await this.checkParent(tx, year.id, input.parentId, input.startDate, input.endDate);
        const period = await tx.academicPeriod.create({
          data: {
            tenantId: requireTenantId(),
            academicYearId: year.id,
            type: input.type,
            name: input.name,
            order: input.order,
            startDate: schoolDateToDb(input.startDate),
            endDate: schoolDateToDb(input.endDate),
            parentId: input.parentId ?? null,
          },
        });
        await writeAudit(tx, {
          action: "period.create",
          entityType: "AcademicPeriod",
          entityId: period.id,
          after: input,
        });
        return this.periodDto(period);
      }),
    );
  }

  async updatePeriod(id: string, input: z.infer<typeof UpdateAcademicPeriodSchema>) {
    return this.savePeriod(() =>
      this.db.$transaction(async (tx) => {
        const before = await tx.academicPeriod.findUnique({ where: { id } });
        if (!before) throw notFound();
        const year = await this.year(tx, before.academicYearId);
        const datesChange = input.startDate !== undefined || input.endDate !== undefined;
        // Dates are fixed once a period is active: lessons and (M3) results already depend on them.
        if (datesChange && before.status !== "DRAFT") throw conflict("PERIOD_NOT_DRAFT");
        const from = input.startDate ?? schoolDateFromDb(before.startDate);
        const to = input.endDate ?? schoolDateFromDb(before.endDate);
        if (from > to) throw fieldError("endDate", "end_before_start");
        this.inYear(year, "startDate", from, to);
        const parentId = input.parentId === undefined ? before.parentId : input.parentId;
        if (parentId) await this.checkParent(tx, year.id, parentId, from, to);
        const period = await tx.academicPeriod.update({
          where: { id },
          data: {
            name: input.name,
            startDate: schoolDateToDb(from),
            endDate: schoolDateToDb(to),
            parentId,
          },
        });
        await writeAudit(tx, {
          action: "period.update",
          entityType: "AcademicPeriod",
          entityId: id,
          before: this.periodDto(before),
          after: input,
        });
        return this.periodDto(period);
      }),
    );
  }

  async activatePeriod(id: string) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.academicPeriod.findUnique({ where: { id } });
      if (!before) throw notFound();
      if (before.status === "ACTIVE") return this.periodDto(before);
      if (before.status === "CLOSED") throw conflict("PERIOD_CLOSED");
      await this.year(tx, before.academicYearId);
      const period = await tx.academicPeriod.update({ where: { id }, data: { status: "ACTIVE" } });
      await writeAudit(tx, {
        action: "period.activate",
        entityType: "AcademicPeriod",
        entityId: id,
        before: { status: before.status },
        after: { status: "ACTIVE" },
      });
      return this.periodDto(period);
    });
  }

  // ---------------------------------------------------------------- school week

  async schoolWeek(academicYearId: string) {
    await this.year(this.db, academicYearId, false);
    const week = await this.db.schoolWeek.findUnique({ where: { academicYearId } });
    return {
      academicYearId,
      workingWeekdays: week ? [...week.workingWeekdays].sort() : DEFAULT_WORKING_WEEKDAYS,
      configured: !!week,
    };
  }

  async setSchoolWeek(academicYearId: string, input: z.infer<typeof UpdateSchoolWeekSchema>) {
    const workingWeekdays = [...input.workingWeekdays].sort();
    return this.db.$transaction(async (tx) => {
      await this.year(tx, academicYearId);
      const before = await tx.schoolWeek.findUnique({ where: { academicYearId } });
      await tx.schoolWeek.upsert({
        where: { academicYearId },
        create: { tenantId: requireTenantId(), academicYearId, workingWeekdays },
        update: { workingWeekdays },
      });
      await writeAudit(tx, {
        action: "school_week.update",
        entityType: "AcademicYear",
        entityId: academicYearId,
        before: { workingWeekdays: before?.workingWeekdays ?? null },
        after: { workingWeekdays },
      });
      return { academicYearId, workingWeekdays, configured: true };
    });
  }

  // ---------------------------------------------------------------- calendar days

  private daySelect = {
    id: true,
    academicYearId: true,
    date: true,
    kind: true,
    title: true,
    followsWeekday: true,
    appliesToAll: true,
    grades: { select: { gradeId: true } },
  } as const;

  private dayDto(d: {
    id: string;
    academicYearId: string;
    date: Date;
    kind: string;
    title: string;
    followsWeekday: number | null;
    appliesToAll: boolean;
    grades: { gradeId: string }[];
  }) {
    return {
      id: d.id,
      academicYearId: d.academicYearId,
      date: schoolDateFromDb(d.date),
      kind: d.kind as "HOLIDAY" | "VACATION" | "NON_WORKING" | "WORKING_OVERRIDE" | "SHORTENED",
      title: d.title,
      followsWeekday: d.followsWeekday,
      appliesToAll: d.appliesToAll,
      gradeIds: d.grades.map((g) => g.gradeId).sort(),
    };
  }

  async listDays(academicYearId: string, q: { from?: SchoolDate; to?: SchoolDate }) {
    await this.year(this.db, academicYearId, false);
    const days = await this.db.calendarDay.findMany({
      where: {
        academicYearId,
        date: { ...(q.from ? { gte: schoolDateToDb(q.from) } : {}), ...(q.to ? { lte: schoolDateToDb(q.to) } : {}) },
      },
      orderBy: { date: "asc" },
      select: this.daySelect,
    });
    return days.map((d) => this.dayDto(d));
  }

  private async checkGrades(tx: DbTransaction, gradeIds: string[] | undefined) {
    if (!gradeIds?.length) return;
    const found = await tx.grade.count({ where: { id: { in: gradeIds } } });
    if (found !== new Set(gradeIds).size) throw fieldError("gradeIds", "invalid");
  }

  /** Creates one day, or each day of a range; a date that already has an entry is a conflict. */
  async createDays(
    academicYearId: string,
    input: z.infer<typeof CreateCalendarDaySchema> | z.infer<typeof CreateCalendarRangeSchema>,
  ) {
    const from = "date" in input ? input.date : input.from;
    const to = "date" in input ? input.date : input.to;
    const dates = [...eachSchoolDate(from, to)];
    if (dates.length > MAX_RANGE_DAYS) throw fieldError("to", "range_too_long");
    return this.db.$transaction(async (tx) => {
      const year = await this.year(tx, academicYearId);
      this.inYear(year, "date" in input ? "date" : "from", from, to);
      await this.checkGrades(tx, input.gradeIds);
      const taken = await tx.calendarDay.findMany({
        where: { academicYearId, date: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) } },
        select: { date: true },
      });
      if (taken.length) throw conflict("DAY_EXISTS", { dates: taken.map((d) => schoolDateFromDb(d.date)) });
      const gradeIds = [...new Set(input.gradeIds ?? [])];
      const created = [];
      for (const date of dates) {
        const day = await tx.calendarDay.create({
          data: {
            tenantId: requireTenantId(),
            academicYearId,
            date: schoolDateToDb(date),
            kind: input.kind,
            title: input.title,
            followsWeekday: input.followsWeekday ?? null,
            appliesToAll: gradeIds.length === 0,
            grades: { create: gradeIds.map((gradeId) => ({ gradeId })) },
          },
          select: this.daySelect,
        });
        created.push(this.dayDto(day));
      }
      await writeAudit(tx, {
        action: "calendar_day.create",
        entityType: "AcademicYear",
        entityId: academicYearId,
        after: { ...input, count: created.length },
      });
      return created;
    });
  }

  async updateDay(id: string, input: z.infer<typeof UpdateCalendarDaySchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.calendarDay.findUnique({ where: { id }, select: this.daySelect });
      if (!before) throw notFound();
      await this.year(tx, before.academicYearId);
      const kind = input.kind ?? before.kind;
      const followsWeekday = input.followsWeekday === undefined ? before.followsWeekday : input.followsWeekday;
      if ((kind === "WORKING_OVERRIDE") !== (followsWeekday != null))
        throw fieldError("followsWeekday", "follows_weekday_rule");
      await this.checkGrades(tx, input.gradeIds);
      const gradeIds = input.gradeIds === undefined ? undefined : [...new Set(input.gradeIds)];
      const day = await tx.calendarDay.update({
        where: { id },
        data: {
          kind,
          title: input.title,
          followsWeekday: kind === "WORKING_OVERRIDE" ? followsWeekday : null,
          ...(gradeIds
            ? {
                appliesToAll: gradeIds.length === 0,
                grades: { deleteMany: {}, create: gradeIds.map((gradeId) => ({ gradeId })) },
              }
            : {}),
        },
        select: this.daySelect,
      });
      await writeAudit(tx, {
        action: "calendar_day.update",
        entityType: "CalendarDay",
        entityId: id,
        before: this.dayDto(before),
        after: input,
      });
      return this.dayDto(day);
    });
  }

  async deleteDay(id: string) {
    await this.db.$transaction(async (tx) => {
      const before = await tx.calendarDay.findUnique({ where: { id }, select: this.daySelect });
      if (!before) throw notFound();
      await this.year(tx, before.academicYearId);
      await tx.calendarDay.delete({ where: { id } });
      await writeAudit(tx, {
        action: "calendar_day.delete",
        entityType: "CalendarDay",
        entityId: id,
        before: this.dayDto(before),
      });
    });
  }

  // ---------------------------------------------------------------- shifts

  private shiftDto(s: { id: string; name: string; startMinute: number; endMinute: number; archivedAt: Date | null }) {
    return {
      id: s.id,
      name: s.name,
      startTime: formatTimeOfDay(s.startMinute),
      endTime: formatTimeOfDay(s.endMinute),
      archived: s.archivedAt !== null,
    };
  }

  async listShifts() {
    const shifts = await this.db.shift.findMany({ orderBy: [{ archivedAt: "asc" }, { startMinute: "asc" }] });
    return shifts.map((s) => this.shiftDto(s));
  }

  async createShift(input: z.infer<typeof CreateShiftSchema>) {
    return this.db.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          tenantId: requireTenantId(),
          name: input.name,
          startMinute: parseTimeOfDay(input.startTime),
          endMinute: parseTimeOfDay(input.endTime),
        },
      });
      await writeAudit(tx, { action: "shift.create", entityType: "Shift", entityId: shift.id, after: input });
      return this.shiftDto(shift);
    });
  }

  async updateShift(id: string, input: z.infer<typeof UpdateShiftSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.shift.findUnique({ where: { id } });
      if (!before) throw notFound();
      const startMinute = input.startTime ? parseTimeOfDay(input.startTime) : before.startMinute;
      const endMinute = input.endTime ? parseTimeOfDay(input.endTime) : before.endMinute;
      if (startMinute >= endMinute) throw fieldError("endTime", "end_before_start");
      if (input.archived && (await tx.classGroup.count({ where: { shiftId: id, archivedAt: null } })))
        throw conflict("SHIFT_IN_USE");
      const shift = await tx.shift.update({
        where: { id },
        data: {
          name: input.name,
          startMinute,
          endMinute,
          ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
        },
      });
      await writeAudit(tx, {
        action: "shift.update",
        entityType: "Shift",
        entityId: id,
        before: this.shiftDto(before),
        after: input,
      });
      return this.shiftDto(shift);
    });
  }

  // ---------------------------------------------------------------- rooms

  private roomDto(r: { id: string; name: string; capacity: number | null; archivedAt: Date | null }) {
    return { id: r.id, name: r.name, capacity: r.capacity, archived: r.archivedAt !== null };
  }

  async listRooms() {
    const rooms = await this.db.room.findMany({ orderBy: [{ archivedAt: "asc" }, { name: "asc" }] });
    return rooms.map((r) => this.roomDto(r));
  }

  async createRoom(input: z.infer<typeof CreateRoomSchema>) {
    return this.db.$transaction(async (tx) => {
      const room = await tx.room.create({
        data: { tenantId: requireTenantId(), name: input.name, capacity: input.capacity ?? null },
      });
      await writeAudit(tx, { action: "room.create", entityType: "Room", entityId: room.id, after: input });
      return this.roomDto(room);
    });
  }

  async updateRoom(id: string, input: z.infer<typeof UpdateRoomSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.room.findUnique({ where: { id } });
      if (!before) throw notFound();
      const room = await tx.room.update({
        where: { id },
        data: {
          name: input.name,
          capacity: input.capacity,
          ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
        },
      });
      await writeAudit(tx, { action: "room.update", entityType: "Room", entityId: id, before, after: input });
      return this.roomDto(room);
    });
  }

  // ---------------------------------------------------------------- bell schedules

  private bellDto(b: {
    id: string;
    academicYearId: string;
    shiftId: string | null;
    name: string;
    validFrom: Date;
    slots: { lessonNumber: number; startMinute: number; endMinute: number }[];
  }) {
    return {
      id: b.id,
      academicYearId: b.academicYearId,
      shiftId: b.shiftId,
      name: b.name,
      validFrom: schoolDateFromDb(b.validFrom),
      slots: [...b.slots]
        .sort((x, y) => x.lessonNumber - y.lessonNumber)
        .map((s) => ({
          lessonNumber: s.lessonNumber,
          startTime: formatTimeOfDay(s.startMinute),
          endTime: formatTimeOfDay(s.endMinute),
        })),
    };
  }

  private slotRows(slots: z.infer<typeof CreateBellScheduleSchema>["slots"]) {
    return slots.map((s) => ({
      lessonNumber: s.lessonNumber,
      startMinute: parseTimeOfDay(s.startTime),
      endMinute: parseTimeOfDay(s.endTime),
    }));
  }

  async listBellSchedules(academicYearId: string) {
    await this.year(this.db, academicYearId, false);
    const schedules = await this.db.bellSchedule.findMany({
      where: { academicYearId },
      include: { slots: true },
      orderBy: [{ shiftId: "asc" }, { validFrom: "asc" }],
    });
    return schedules.map((b) => this.bellDto(b));
  }

  /** One schedule per shift and start date: a change of bell times is a new schedule from a later date. */
  private async checkBellUnique(
    tx: DbTransaction,
    academicYearId: string,
    shiftId: string | null,
    validFrom: SchoolDate,
    exceptId?: string,
  ) {
    const clash = await tx.bellSchedule.findFirst({
      where: {
        academicYearId,
        shiftId,
        validFrom: schoolDateToDb(validFrom),
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw conflict("BELL_SCHEDULE_EXISTS");
  }

  async createBellSchedule(academicYearId: string, input: z.infer<typeof CreateBellScheduleSchema>) {
    return this.db.$transaction(async (tx) => {
      const year = await this.year(tx, academicYearId);
      this.inYear(year, "validFrom", input.validFrom);
      const shiftId = input.shiftId ?? null;
      if (shiftId && !(await tx.shift.findFirst({ where: { id: shiftId, archivedAt: null } }))) throw notFound();
      await this.checkBellUnique(tx, academicYearId, shiftId, input.validFrom);
      const schedule = await tx.bellSchedule.create({
        data: {
          tenantId: requireTenantId(),
          academicYearId,
          shiftId,
          name: input.name,
          validFrom: schoolDateToDb(input.validFrom),
          slots: { create: this.slotRows(input.slots) },
        },
        include: { slots: true },
      });
      await writeAudit(tx, {
        action: "bell_schedule.create",
        entityType: "BellSchedule",
        entityId: schedule.id,
        after: input,
      });
      return this.bellDto(schedule);
    });
  }

  async updateBellSchedule(id: string, input: z.infer<typeof UpdateBellScheduleSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.bellSchedule.findUnique({ where: { id }, include: { slots: true } });
      if (!before) throw notFound();
      const year = await this.year(tx, before.academicYearId);
      if (input.validFrom) {
        this.inYear(year, "validFrom", input.validFrom);
        await this.checkBellUnique(tx, before.academicYearId, before.shiftId, input.validFrom, id);
      }
      const schedule = await tx.bellSchedule.update({
        where: { id },
        data: {
          name: input.name,
          ...(input.validFrom ? { validFrom: schoolDateToDb(input.validFrom) } : {}),
          ...(input.slots ? { slots: { deleteMany: {}, create: this.slotRows(input.slots) } } : {}),
        },
        include: { slots: true },
      });
      await writeAudit(tx, {
        action: "bell_schedule.update",
        entityType: "BellSchedule",
        entityId: id,
        before: this.bellDto(before),
        after: input,
      });
      return this.bellDto(schedule);
    });
  }
}
