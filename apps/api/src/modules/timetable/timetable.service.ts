// M2 step 2: versioned weekly timetable. A DRAFT is edited freely (entries replaced as a whole); publishing fixes it
// (SQL trigger TimetableEntry_frozen) and closes the previous version the day before. Lesson sessions are generated
// from published versions in step 3.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  CreateTimetableSchema,
  PublishTimetableSchema,
  ReplaceTimetableEntriesSchema,
  TimetableViewQuerySchema,
} from "@idrok/shared";
import { addSchoolDays, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { findConflicts, type GroupInfo } from "../../domain/timetable";
import { AppError, isConstraintError, notFound } from "../../http/errors";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });
const fieldError = (path: string, code: string) => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const entryInclude = {
  teachingGroup: { select: { name: true, kind: true, classGroupId: true, classGroup: { select: { name: true } } } },
  subject: { select: { name: true } },
  teacher: { select: { firstName: true, lastName: true } },
  room: { select: { name: true } },
} satisfies Prisma.TimetableEntryInclude;
type EntryRow = Prisma.TimetableEntryGetPayload<{ include: typeof entryInclude }>;

type TimetableRow = {
  id: string;
  academicYearId: string;
  version: number;
  status: string;
  validFrom: Date | null;
  validTo: Date | null;
  note: string | null;
  publishedAt: Date | null;
};

/** "7-A" for the whole class, "7-A · Ingliz 1" for a subgroup. */
const groupName = (g: EntryRow["teachingGroup"]) =>
  g.kind === "SUBGROUP" && g.classGroup ? `${g.classGroup.name} · ${g.name}` : g.name;

export class TimetableService {
  constructor(private readonly db: Db) {}

  private summary(t: TimetableRow, entryCount: number) {
    return {
      id: t.id,
      academicYearId: t.academicYearId,
      version: t.version,
      status: t.status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
      validFrom: t.validFrom ? schoolDateFromDb(t.validFrom) : null,
      validTo: t.validTo ? schoolDateFromDb(t.validTo) : null,
      note: t.note,
      entryCount,
      publishedAt: t.publishedAt?.toISOString() ?? null,
    };
  }

  private async year(tx: DbTransaction | Db, id: string, forWrite = true) {
    const year = await tx.academicYear.findUnique({ where: { id } });
    if (!year) throw notFound();
    if (forWrite && year.status === "ARCHIVED") throw conflict("YEAR_ARCHIVED");
    return year;
  }

  async list(academicYearId: string) {
    await this.year(this.db, academicYearId, false);
    const rows = await this.db.timetable.findMany({
      where: { academicYearId },
      orderBy: { version: "desc" },
      include: { _count: { select: { entries: true } } },
    });
    return rows.map((t) => this.summary(t, t._count.entries));
  }

  async create(academicYearId: string, input: z.infer<typeof CreateTimetableSchema>, userId: string) {
    return this.db.$transaction(async (tx) => {
      await this.year(tx, academicYearId);
      const source = input.copyFromId
        ? await tx.timetable.findUnique({ where: { id: input.copyFromId }, include: { entries: true } })
        : null;
      if (input.copyFromId && (!source || source.academicYearId !== academicYearId)) throw notFound();
      const last = await tx.timetable.aggregate({ where: { academicYearId }, _max: { version: true } });
      const tenantId = requireTenantId();
      const created = await tx.timetable.create({
        data: {
          tenantId,
          academicYearId,
          version: (last._max.version ?? 0) + 1,
          note: input.note ?? null,
          createdById: userId,
        },
      });
      if (source?.entries.length) {
        await tx.timetableEntry.createMany({
          data: source.entries.map((e) => ({
            tenantId,
            timetableId: created.id,
            teachingGroupId: e.teachingGroupId,
            subjectId: e.subjectId,
            teacherId: e.teacherId,
            roomId: e.roomId,
            weekday: e.weekday,
            lessonNumber: e.lessonNumber,
            weekType: e.weekType,
          })),
        });
      }
      await writeAudit(tx, {
        action: "timetable.create",
        entityType: "Timetable",
        entityId: created.id,
        after: { version: created.version, copyFromId: input.copyFromId ?? null },
      });
      return this.summary(created, source?.entries.length ?? 0);
    });
  }

  /** Conflicts (blocking) and unassigned teachers (warning) of a set of entries. */
  private async analyse(tx: DbTransaction | Db, academicYearId: string, entries: EntryRow[]) {
    const groups = new Map<string, GroupInfo>(
      entries.map((e) => [
        e.teachingGroupId,
        {
          id: e.teachingGroupId,
          kind: e.teachingGroup.kind,
          classGroupId: e.teachingGroup.classGroupId,
        },
      ]),
    );
    const conflicts = findConflicts(entries, groups).map((c) => ({
      kind: c.kind,
      weekday: c.weekday,
      lessonNumber: c.lessonNumber,
      entryIds: c.entries.map((i) => entries[i]!.id),
    }));
    const today = schoolDateToDb((await schoolClock(this.db)).today);
    const assignments = await tx.teacherAssignment.findMany({
      where: { academicYearId, OR: [{ validTo: null }, { validTo: { gte: today } }] },
      select: { teacherId: true, teachingGroupId: true, subjectId: true },
    });
    const assigned = new Set(assignments.map((a) => `${a.teacherId}|${a.teachingGroupId}|${a.subjectId}`));
    const warnings = entries
      .filter((e) => !assigned.has(`${e.teacherId}|${e.teachingGroupId}|${e.subjectId}`))
      .map((e) => ({ kind: "UNASSIGNED_TEACHER" as const, entryId: e.id }));
    return { conflicts, warnings };
  }

  private entryDto(e: EntryRow) {
    return {
      id: e.id,
      teachingGroupId: e.teachingGroupId,
      teachingGroupName: groupName(e.teachingGroup),
      classGroupId: e.teachingGroup.classGroupId,
      subjectId: e.subjectId,
      subjectName: e.subject.name,
      teacherId: e.teacherId,
      teacherName: `${e.teacher.lastName} ${e.teacher.firstName}`,
      roomId: e.roomId,
      roomName: e.room?.name ?? null,
      weekday: e.weekday,
      lessonNumber: e.lessonNumber,
      weekType: e.weekType,
    };
  }

  private async detail(tx: DbTransaction | Db, t: TimetableRow, q: z.infer<typeof TimetableViewQuerySchema> = {}) {
    const all = await tx.timetableEntry.findMany({
      where: { timetableId: t.id },
      include: entryInclude,
      orderBy: [{ weekday: "asc" }, { lessonNumber: "asc" }],
    });
    // Conflicts are judged on the whole timetable, then filtered to the requested view.
    const { conflicts, warnings } = await this.analyse(tx, t.academicYearId, all);
    const visible =
      q.view && q.id
        ? all.filter((e) =>
            q.view === "teacher"
              ? e.teacherId === q.id
              : q.view === "room"
                ? e.roomId === q.id
                : e.teachingGroup.classGroupId === q.id || e.teachingGroupId === q.id,
          )
        : all;
    const ids = new Set(visible.map((e) => e.id));
    return {
      ...this.summary(t, all.length),
      entries: visible.map((e) => this.entryDto(e)),
      conflicts: conflicts.filter((c) => c.entryIds.some((id) => ids.has(id))),
      warnings: warnings.filter((w) => ids.has(w.entryId)),
    };
  }

  async get(id: string, q: z.infer<typeof TimetableViewQuerySchema>) {
    const t = await this.db.timetable.findUnique({ where: { id } });
    if (!t) throw notFound();
    return this.detail(this.db, t, q);
  }

  /** Replaces all entries of a DRAFT; every reference must belong to the timetable's year and be in use. */
  async replaceEntries(id: string, input: z.infer<typeof ReplaceTimetableEntriesSchema>) {
    return this.db.$transaction(async (tx) => {
      const t = await tx.timetable.findUnique({ where: { id } });
      if (!t) throw notFound();
      if (t.status !== "DRAFT") throw conflict("TIMETABLE_NOT_DRAFT");
      await this.year(tx, t.academicYearId);
      const ids = (key: "teachingGroupId" | "subjectId" | "teacherId" | "roomId") => [
        ...new Set(input.entries.map((e) => e[key]).filter((v): v is string => !!v)),
      ];
      const [groups, subjects, teachers, rooms] = await Promise.all([
        tx.teachingGroup.findMany({
          where: { id: { in: ids("teachingGroupId") }, academicYearId: t.academicYearId, archivedAt: null },
          select: { id: true },
        }),
        tx.subject.findMany({ where: { id: { in: ids("subjectId") }, archivedAt: null }, select: { id: true } }),
        tx.employee.findMany({ where: { id: { in: ids("teacherId") }, status: "ACTIVE" }, select: { id: true } }),
        tx.room.findMany({ where: { id: { in: ids("roomId") }, archivedAt: null }, select: { id: true } }),
      ]);
      const check = (key: Parameters<typeof ids>[0], found: { id: string }[]) => {
        const ok = new Set(found.map((r) => r.id));
        const bad = input.entries.findIndex((e) => e[key] && !ok.has(e[key]));
        if (bad >= 0) throw fieldError(`entries.${bad}.${key}`, "invalid");
      };
      check("teachingGroupId", groups);
      check("subjectId", subjects);
      check("teacherId", teachers);
      check("roomId", rooms);

      const tenantId = requireTenantId();
      const before = await tx.timetableEntry.count({ where: { timetableId: id } });
      await tx.timetableEntry.deleteMany({ where: { timetableId: id } });
      await tx.timetableEntry.createMany({
        data: input.entries.map((e) => ({
          tenantId,
          timetableId: id,
          teachingGroupId: e.teachingGroupId,
          subjectId: e.subjectId,
          teacherId: e.teacherId,
          roomId: e.roomId ?? null,
          weekday: e.weekday,
          lessonNumber: e.lessonNumber,
          weekType: e.weekType,
        })),
      });
      await writeAudit(tx, {
        action: "timetable.entries",
        entityType: "Timetable",
        entityId: id,
        before: { count: before },
        after: { count: input.entries.length },
      });
      return this.detail(tx, t);
    });
  }

  async publish(id: string, input: z.infer<typeof PublishTimetableSchema>, userId: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const t = await tx.timetable.findUnique({ where: { id } });
        if (!t) throw notFound();
        if (t.status !== "DRAFT") throw conflict("TIMETABLE_NOT_DRAFT");
        const year = await this.year(tx, t.academicYearId);
        const from = input.validFrom;
        if (from < schoolDateFromDb(year.startDate) || from > schoolDateFromDb(year.endDate))
          throw fieldError("validFrom", "outside_academic_year");
        const current = await this.detail(tx, t);
        if (current.entries.length === 0) throw conflict("TIMETABLE_EMPTY");
        if (current.conflicts.length) throw conflict("TIMETABLE_HAS_CONFLICTS", { count: current.conflicts.length });

        // The newest published version ends the day before; an older start date would rewrite history.
        const previous = await tx.timetable.findFirst({
          where: { academicYearId: t.academicYearId, status: "PUBLISHED" },
          orderBy: { validFrom: "desc" },
        });
        const prevFrom = previous?.validFrom ? schoolDateFromDb(previous.validFrom) : null;
        if (prevFrom && from <= prevFrom) throw fieldError("validFrom", "not_after_previous");
        if (previous && (!previous.validTo || schoolDateFromDb(previous.validTo) >= from)) {
          await tx.timetable.update({
            where: { id: previous.id },
            data: { validTo: schoolDateToDb(addSchoolDays(from as SchoolDate, -1)) },
          });
        }
        const published = await tx.timetable.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            validFrom: schoolDateToDb(from),
            validTo: null,
            publishedAt: new Date(),
            publishedById: userId,
          },
        });
        await writeAudit(tx, {
          action: "timetable.publish",
          entityType: "Timetable",
          entityId: id,
          before: { previousId: previous?.id ?? null, previousValidTo: previous?.validTo ?? null },
          after: { validFrom: from, version: t.version },
        });
        return this.summary(published, current.entries.length);
      });
    } catch (err) {
      if (isConstraintError(err, "Timetable_no_overlap")) throw conflict("TIMETABLE_OVERLAP");
      throw err;
    }
  }

  async remove(id: string) {
    await this.db.$transaction(async (tx) => {
      const t = await tx.timetable.findUnique({ where: { id } });
      if (!t) throw notFound();
      if (t.status !== "DRAFT") throw conflict("TIMETABLE_NOT_DRAFT");
      await tx.timetable.delete({ where: { id } });
      await writeAudit(tx, {
        action: "timetable.delete",
        entityType: "Timetable",
        entityId: id,
        before: { version: t.version },
      });
    });
  }
}
