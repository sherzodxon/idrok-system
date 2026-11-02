// Tests (tests.md §4.1, §5, §6, §7): a DRAFT is built (questions by hand or a pool rule), checked and published;
// publishing freezes the question versions. SCHEDULED → OPEN → CLOSED follows the window: a delayed job at each edge
// (through the outbox, `availableAt`) and a lazy refresh on every read, so a missed job changes nothing.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  CreateTestSchema,
  SetTestQuestionsSchema,
  TestDetailDto,
  TestDto,
  TestListQuerySchema,
  TestProblem,
  TestSelection,
  UpdateTestSchema,
} from "@idrok/shared";
import { sum } from "@idrok/shared/decimal";
import { parseSchoolDate, schoolDateFromDb, schoolDateToDb, toSchoolDate } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import { attemptDeadline, questionProblems, selectFromPool, type PoolCandidate } from "../../domain/tests";
import { activeOn, resolveScope, type DataScope } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { gradable, versionDto } from "../question-bank/question-bank.service";

type TestListQuery = z.infer<typeof TestListQuerySchema>;

const include = {
  subject: { select: { name: true } },
  grade: { select: { name: true } },
  teacher: { select: { firstName: true, lastName: true } },
  testType: { select: { code: true, name: true } },
  period: { select: { name: true, status: true } },
  assignments: {
    include: {
      teachingGroup: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
    },
  },
  _count: { select: { questions: true, attempts: true } },
} satisfies Prisma.TestInclude;
type Row = Prisma.TestGetPayload<{ include: typeof include }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function testDto(t: Row): TestDto {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    subjectId: t.subjectId,
    subjectName: t.subject.name,
    gradeId: t.gradeId,
    gradeName: t.grade.name,
    teacherId: t.teacherId,
    teacherName: `${t.teacher.lastName} ${t.teacher.firstName}`,
    testTypeId: t.testTypeId,
    testTypeCode: t.testType.code,
    testTypeName: t.testType.name,
    format: t.format,
    purpose: t.purpose,
    status: t.status,
    startsAt: iso(t.startsAt),
    endsAt: iso(t.endsAt),
    schoolDate: t.schoolDate ? schoolDateFromDb(t.schoolDate) : null,
    timeLimitMinutes: t.timeLimitMinutes,
    questionCount: t.questionCount,
    shuffleQuestions: t.shuffleQuestions,
    shuffleOptions: t.shuffleOptions,
    selection: t.selection as TestSelection,
    maxScore: t.maxScore.toString(),
    multipleScoring: t.multipleScoring,
    periodId: t.periodId,
    periodName: t.period?.name ?? null,
    weight: t.weight?.toString() ?? null,
    includedInAssessment: t.includedInAssessment,
    retakePolicy: t.retakePolicy,
    violationThreshold: t.violationThreshold,
    showResultToStudent: t.showResultToStudent,
    planItemId: t.planItemId,
    assignments: t.assignments.map((a) => ({
      teachingGroupId: a.teachingGroupId,
      studentId: a.studentId,
      name: a.teachingGroup?.name ?? (a.student ? `${a.student.lastName} ${a.student.firstName}` : ""),
    })),
    questionsTotal: t._count.questions,
    attempts: t._count.attempts,
    publishedAt: iso(t.publishedAt),
    closedAt: iso(t.closedAt),
    createdAt: t.createdAt.toISOString(),
  };
}

const EDITABLE_AFTER_PUBLISH = new Set([
  "title",
  "description",
  "startsAt",
  "endsAt",
  "timeLimitMinutes",
  "applyToRunning",
]);

/** Moves tests whose window edge has passed (SCHEDULED → OPEN, OPEN → CLOSED). Idempotent; safe to call anywhere. */
export async function refreshTestStatuses(db: Db | DbTransaction, where: Prisma.TestWhereInput = {}) {
  const now = new Date();
  await db.test.updateMany({
    where: { ...where, status: "SCHEDULED", OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    data: { status: "OPEN" },
  });
  await db.test.updateMany({
    where: { ...where, status: { in: ["SCHEDULED", "OPEN"] }, format: "ONLINE", endsAt: { lte: now } },
    data: { status: "CLOSED", closedAt: now },
  });
}

/** Delayed status jobs at the window edges (delivered when due by the outbox relay). */
async function scheduleStatusJobs(tx: DbTransaction, test: { id: string; startsAt: Date | null; endsAt: Date | null }) {
  const tenantId = requireTenantId();
  for (const at of [test.startsAt, test.endsAt]) {
    if (!at || at <= new Date()) continue;
    await tx.outboxEvent.create({
      data: {
        tenantId,
        type: "test.status_due",
        aggregateType: "Test",
        aggregateId: test.id,
        payload: { tenantId, testId: test.id },
        availableAt: at,
      },
    });
  }
}

export class TestsService {
  constructor(private readonly db: Db) {}

  private async scope(auth: RequestAuth): Promise<DataScope> {
    const { timezone } = await schoolClock(this.db);
    return resolveScope(this.db, auth, timezone);
  }

  /** Teachers see their own tests; school-wide roles every test. */
  async testWhere(auth: RequestAuth): Promise<Prisma.TestWhereInput> {
    const scope = await this.scope(auth);
    if (scope.kind === "school") return {};
    if (scope.kind === "teacher") return { teacherId: scope.employeeId };
    return { id: { in: [] } };
  }

  async list(auth: RequestAuth, q: TestListQuery) {
    await refreshTestStatuses(this.db);
    const where: Prisma.TestWhereInput = {
      AND: [
        await this.testWhere(auth),
        {
          ...(q.subjectId ? { subjectId: q.subjectId } : {}),
          ...(q.gradeId ? { gradeId: q.gradeId } : {}),
          ...(q.periodId ? { periodId: q.periodId } : {}),
          ...(q.status ? { status: q.status } : { status: { not: "ARCHIVED" as const } }),
          ...(q.format ? { format: q.format } : {}),
          ...(q.purpose ? { purpose: q.purpose } : {}),
          ...(q.teachingGroupId ? { assignments: { some: { teachingGroupId: q.teachingGroupId } } } : {}),
          ...(q.q ? { title: { contains: q.q, mode: "insensitive" as const } } : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.db.test.findMany({
        where,
        include,
        orderBy: orderBy(q.sort, ["createdAt", "startsAt", "title"] as const, [{ createdAt: "desc" }]),
        ...skipTake(q),
      }),
      this.db.test.count({ where }),
    ]);
    return page(rows.map(testDto), total, q);
  }

  async find(auth: RequestAuth, id: string, tx: Db | DbTransaction = this.db) {
    await refreshTestStatuses(tx, { id });
    const row = await tx.test.findFirst({ where: { AND: [{ id }, await this.testWhere(auth)] }, include });
    if (!row) throw notFound();
    return row;
  }

  async get(auth: RequestAuth, id: string): Promise<TestDetailDto> {
    const row = await this.find(auth, id);
    const questions = await this.db.testQuestion.findMany({
      where: { testId: id },
      orderBy: { order: "asc" },
      include: { questionVersion: { include: { question: { include: { topic: { select: { title: true } } } } } } },
    });
    return {
      ...testDto(row),
      questions: questions.map((tq) => {
        const q = tq.questionVersion.question;
        return {
          id: tq.id,
          order: tq.order,
          points: tq.points.toString(),
          questionId: q.id,
          topicId: q.topicId,
          topicTitle: q.topic?.title ?? null,
          difficulty: q.difficulty,
          type: q.type,
          version: versionDto(tq.questionVersion),
          newerVersion: q.currentVersionId !== tq.questionVersionId,
        };
      }),
    };
  }

  // ---- create and edit

  /** The groups and students a test may be given to: a teacher only their own groups (and their students). */
  private async checkAssignees(
    tx: DbTransaction,
    scope: DataScope,
    assignTo: { teachingGroupIds: string[]; studentIds: string[] },
  ) {
    const groups = await tx.teachingGroup.findMany({
      where: { id: { in: assignTo.teachingGroupIds }, archivedAt: null },
      select: { id: true },
    });
    const allowed = (id: string) =>
      scope.kind === "school" || (scope.kind === "teacher" && scope.teachingGroupIds.includes(id));
    if (groups.length !== new Set(assignTo.teachingGroupIds).size || !assignTo.teachingGroupIds.every(allowed))
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "assignTo.teachingGroupIds", code: "invalid" }] });
    if (!assignTo.studentIds.length) return;
    const { today } = await schoolClock(tx as unknown as Db);
    const students = await tx.student.findMany({
      where: {
        id: { in: assignTo.studentIds },
        ...(scope.kind === "teacher"
          ? { groupMemberships: { some: { teachingGroupId: { in: scope.teachingGroupIds }, ...activeOn(today) } } }
          : {}),
      },
      select: { id: true },
    });
    if (students.length !== new Set(assignTo.studentIds).size)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "assignTo.studentIds", code: "invalid" }] });
  }

  private async setAssignees(
    tx: DbTransaction,
    testId: string,
    assignTo: { teachingGroupIds: string[]; studentIds: string[] },
  ) {
    await tx.testAssignment.deleteMany({ where: { testId } });
    const tenantId = requireTenantId();
    await tx.testAssignment.createMany({
      data: [
        ...[...new Set(assignTo.teachingGroupIds)].map((teachingGroupId) => ({ tenantId, testId, teachingGroupId })),
        ...[...new Set(assignTo.studentIds)].map((studentId) => ({ tenantId, testId, studentId })),
      ],
    });
  }

  private async checkRefs(
    tx: DbTransaction,
    input: {
      testTypeId?: string;
      periodId?: string | null;
      planItemId?: string | null;
      subjectId?: string;
      gradeId?: string;
    },
  ) {
    const bad = (path: string) => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code: "invalid" }] });
    if (input.testTypeId && !(await tx.testType.findFirst({ where: { id: input.testTypeId, isActive: true } })))
      throw bad("testTypeId");
    if (input.periodId) {
      const period = await tx.academicPeriod.findFirst({ where: { id: input.periodId } });
      if (!period) throw bad("periodId");
      // Acceptance 14: a weighted test cannot be attached to a closed period.
      if (period.status === "CLOSED") throw new AppError("CONFLICT", 409, { reason: "PERIOD_CLOSED" });
    }
    if (input.planItemId && !(await tx.planItem.findFirst({ where: { id: input.planItemId } })))
      throw bad("planItemId");
    if (input.subjectId && !(await tx.subject.findFirst({ where: { id: input.subjectId } }))) throw bad("subjectId");
    if (input.gradeId && !(await tx.grade.findFirst({ where: { id: input.gradeId } }))) throw bad("gradeId");
  }

  async create(auth: RequestAuth, input: z.infer<typeof CreateTestSchema>) {
    const id = await this.db.$transaction(async (tx) => {
      const scope = await this.scope(auth);
      let teacherId: string;
      if (scope.kind === "teacher") {
        if (input.teacherId && input.teacherId !== scope.employeeId) throw forbidden({ reason: "OWN_TESTS_ONLY" });
        teacherId = scope.employeeId;
      } else if (scope.kind === "school") {
        const own = await tx.user.findUniqueOrThrow({
          where: { id: auth.userId },
          select: { employee: { select: { id: true } } },
        });
        const chosen = input.teacherId ?? own.employee?.id;
        if (!chosen || !(await tx.employee.findFirst({ where: { id: chosen } })))
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "teacherId", code: "required" }] });
        teacherId = chosen;
      } else throw forbidden();
      await this.checkRefs(tx, input);
      await this.checkAssignees(tx, scope, input.assignTo);
      const test = await tx.test
        .create({
          data: {
            tenantId: requireTenantId(),
            title: input.title,
            description: input.description ?? null,
            subjectId: input.subjectId,
            gradeId: input.gradeId,
            teacherId,
            testTypeId: input.testTypeId,
            format: input.format,
            purpose: input.purpose,
            startsAt: input.startsAt ? new Date(input.startsAt) : null,
            endsAt: input.endsAt ? new Date(input.endsAt) : null,
            schoolDate: input.schoolDate ? schoolDateToDb(parseSchoolDate(input.schoolDate)) : null,
            timeLimitMinutes: input.timeLimitMinutes ?? null,
            questionCount: input.questionCount ?? null,
            shuffleQuestions: input.shuffleQuestions,
            shuffleOptions: input.shuffleOptions,
            selection: input.selection,
            maxScore: input.format === "OFFLINE" ? (input.maxScore ?? "20") : 0,
            multipleScoring: input.multipleScoring,
            periodId: input.periodId ?? null,
            weight: input.weight ?? (input.purpose === "WEIGHTED" ? "1" : null),
            includedInAssessment: input.includedInAssessment,
            retakePolicy: input.retakePolicy,
            violationThreshold: input.violationThreshold,
            showResultToStudent: input.showResultToStudent,
            planItemId: input.planItemId ?? null,
            createdById: auth.userId,
          },
        })
        .catch((err: unknown) => {
          throw constraintToValidation(err);
        });
      await this.setAssignees(tx, test.id, input.assignTo);
      await writeAudit(tx, {
        action: "test.create",
        entityType: "Test",
        entityId: test.id,
        after: { title: input.title },
      });
      return test.id;
    });
    return this.get(auth, id);
  }

  async update(auth: RequestAuth, id: string, input: z.infer<typeof UpdateTestSchema>) {
    await this.db.$transaction(async (tx) => {
      const test = await this.find(auth, id, tx);
      if (test.status === "CLOSED" || test.status === "ARCHIVED")
        throw new AppError("CONFLICT", 409, { reason: "TEST_CLOSED" });
      if (test.status !== "DRAFT") {
        const locked = Object.keys(input).filter((k) => !EDITABLE_AFTER_PUBLISH.has(k));
        if (locked.length) throw new AppError("CONFLICT", 409, { reason: "TEST_PUBLISHED", fields: locked });
        if (input.startsAt !== undefined && test.status !== "SCHEDULED")
          throw new AppError("CONFLICT", 409, { reason: "TEST_ALREADY_STARTED" });
      }
      const scope = await this.scope(auth);
      await this.checkRefs(tx, input);
      if (input.assignTo) await this.checkAssignees(tx, scope, input.assignTo);
      const { assignTo, applyToRunning, schoolDate, maxScore, startsAt: _s, endsAt: _e, ...fields } = input;
      const startsAt = input.startsAt === undefined ? test.startsAt : input.startsAt ? new Date(input.startsAt) : null;
      const endsAt = input.endsAt === undefined ? test.endsAt : input.endsAt ? new Date(input.endsAt) : null;
      if (test.status !== "DRAFT" && endsAt && endsAt <= new Date())
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "endsAt", code: "in_past" }] });
      await tx.test
        .update({
          where: { id },
          data: {
            ...fields,
            startsAt,
            endsAt,
            ...(schoolDate !== undefined
              ? { schoolDate: schoolDate ? schoolDateToDb(parseSchoolDate(schoolDate)) : null }
              : {}),
            ...(maxScore !== undefined && test.format === "OFFLINE" ? { maxScore: maxScore ?? "20" } : {}),
          },
        })
        .catch((err: unknown) => {
          throw constraintToValidation(err);
        });
      if (assignTo) await this.setAssignees(tx, id, assignTo);
      if (test.status !== "DRAFT") {
        if (test.status === "SCHEDULED" && startsAt && startsAt <= new Date())
          await tx.test.update({ where: { id }, data: { status: "OPEN" } });
        await scheduleStatusJobs(tx, { id, startsAt, endsAt });
        // §5: running attempts keep their deadline unless asked; their students' own windows are not touched.
        if (applyToRunning) {
          const overridden = new Set(
            (await tx.testWindowOverride.findMany({ where: { testId: id }, select: { studentId: true } })).map(
              (o) => o.studentId,
            ),
          );
          const running = await tx.testAttempt.findMany({ where: { testId: id, status: "IN_PROGRESS" } });
          const limit = fields.timeLimitMinutes === undefined ? test.timeLimitMinutes : fields.timeLimitMinutes;
          for (const a of running.filter((r) => !overridden.has(r.studentId)))
            await tx.testAttempt.update({
              where: { id: a.id },
              data: { deadline: attemptDeadline(a.startedAt, { endsAt, timeLimitMinutes: limit }) },
            });
        }
      }
      await writeAudit(tx, {
        action: "test.update",
        entityType: "Test",
        entityId: id,
        after: { fields: Object.keys(input), applyToRunning: applyToRunning ?? false },
      });
    });
    return this.get(auth, id);
  }

  /** MANUAL selection: the questions of a DRAFT, in order (the current version of each; points default to its own). */
  async setQuestions(auth: RequestAuth, id: string, input: z.infer<typeof SetTestQuestionsSchema>) {
    await this.db.$transaction(async (tx) => {
      const test = await this.find(auth, id, tx);
      if (test.status !== "DRAFT") throw new AppError("CONFLICT", 409, { reason: "TEST_PUBLISHED" });
      if (test.format !== "ONLINE") throw new AppError("CONFLICT", 409, { reason: "OFFLINE_HAS_NO_QUESTIONS" });
      const ids = input.questions.map((q) => q.questionId);
      if (new Set(ids).size !== ids.length)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "questions", code: "duplicate" }] });
      const visible = await this.bankWhere(auth, tx);
      const found = await tx.question.findMany({
        where: {
          AND: [visible, { id: { in: ids }, subjectId: test.subjectId, gradeId: test.gradeId, status: "ACTIVE" }],
        },
        include: { currentVersion: true },
      });
      if (found.length !== ids.length)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "questions", code: "invalid" }] });
      const byId = new Map(found.map((q) => [q.id, q]));
      await tx.testQuestion.deleteMany({ where: { testId: id } });
      await tx.testQuestion.createMany({
        data: input.questions.map((q, order) => {
          const v = byId.get(q.questionId)!.currentVersion!;
          return {
            tenantId: requireTenantId(),
            testId: id,
            questionVersionId: v.id,
            order,
            points: q.points ?? v.points,
          };
        }),
      });
      await writeAudit(tx, {
        action: "test.questions",
        entityType: "Test",
        entityId: id,
        after: { count: ids.length },
      });
    });
    return this.get(auth, id);
  }

  /** The bank the test's teacher may draw from (their own and shared questions of the subject). */
  private async bankWhere(auth: RequestAuth, tx: DbTransaction): Promise<Prisma.QuestionWhereInput> {
    const scope = await this.scope(auth);
    if (scope.kind === "school") return {};
    if (scope.kind !== "teacher") return { id: { in: [] } };
    const { today } = await schoolClock(tx as unknown as Db);
    const subjects = await tx.teacherAssignment.findMany({
      where: { teacherId: scope.employeeId, ...activeOn(today) },
      select: { subjectId: true },
    });
    return {
      OR: [
        { ownerId: scope.employeeId },
        { sharedWithSubject: true, subjectId: { in: subjects.map((s) => s.subjectId) } },
      ],
    };
  }

  // ---- publish (§4.1)

  /** Everything that keeps a test from being published; empty = ready. */
  async problems(auth: RequestAuth, id: string, tx: Db | DbTransaction = this.db) {
    const test = await this.find(auth, id, tx);
    return (await this.check(auth, test, tx as DbTransaction)).problems;
  }

  private async check(auth: RequestAuth, test: Row, tx: DbTransaction) {
    const problems = new Set<TestProblem>();
    const settings = await tx.schoolSettings.findFirst({ select: { maxQuestionsPerTest: true } });
    const maxQuestions = settings?.maxQuestionsPerTest ?? 50;
    let pool: { versionId: string; points: Prisma.Decimal }[] = [];
    if (test.assignments.length === 0) problems.add("NO_ASSIGNMENT");
    if (test.purpose === "WEIGHTED") {
      if (!test.periodId || !test.weight) problems.add("WEIGHTED_NEEDS_PERIOD");
      if (test.period?.status === "CLOSED") problems.add("PERIOD_CLOSED");
    }
    if (test.format === "OFFLINE") {
      if (!test.schoolDate) problems.add("OFFLINE_NEEDS_DATE");
      if (!["5", "10", "20", "25", "40", "50", "100"].includes(test.maxScore.toString())) problems.add("OFFLINE_SCALE");
      return { problems: [...problems], pool };
    }
    if (test.startsAt && test.endsAt && test.startsAt >= test.endsAt) problems.add("WINDOW_INVALID");
    if (test.endsAt && test.endsAt <= new Date()) problems.add("WINDOW_IN_PAST");

    const selection = test.selection as TestSelection;
    if (selection.mode === "MANUAL") {
      const questions = await tx.testQuestion.findMany({
        where: { testId: test.id },
        orderBy: { order: "asc" },
        include: { questionVersion: { include: { question: { include: { currentVersion: true } } } } },
      });
      // Publishing takes each question's current version (a teacher edits the bank while drafting); points set by
      // hand stay, points left at the version's default follow the new version.
      pool = questions.map((tq) => {
        const cur = tq.questionVersion.question.currentVersion!;
        const custom = !tq.points.equals(tq.questionVersion.points);
        return { versionId: cur.id, points: custom ? tq.points : cur.points };
      });
      if (!questions.length) problems.add("NO_QUESTIONS");
      if ((test.questionCount ?? questions.length) > maxQuestions) problems.add("TOO_MANY_QUESTIONS");
      if (test.questionCount && test.questionCount > questions.length) problems.add("QUESTION_COUNT_ABOVE_POOL");
      for (const tq of questions) {
        const cur = tq.questionVersion.question.currentVersion!;
        if (questionProblems({ ...gradable(tq.questionVersion.question.type, cur), text: cur.text }).length)
          problems.add("QUESTION_INVALID");
      }
    } else {
      const candidates = await tx.question.findMany({
        where: {
          AND: [await this.bankWhere(auth, tx), { subjectId: test.subjectId, gradeId: test.gradeId, status: "ACTIVE" }],
        },
        include: { currentVersion: true },
      });
      const valid = candidates.filter(
        (q) => !questionProblems({ ...gradable(q.type, q.currentVersion!), text: q.currentVersion!.text }).length,
      );
      const asCandidates: PoolCandidate[] = valid.map((q) => ({
        id: q.id,
        topicId: q.topicId,
        difficulty: q.difficulty,
      }));
      if (!selectFromPool(selection.rules, asCandidates, test.id)) problems.add("POOL_RULE_UNFILLABLE");
      const perAttempt = selection.rules.reduce((n, r) => n + r.count, 0);
      if (perAttempt > maxQuestions) problems.add("TOO_MANY_QUESTIONS");
      const matches = (q: (typeof valid)[number]) =>
        selection.rules.some(
          (r) =>
            (r.topicId === null || r.topicId === q.topicId) && (r.difficulty === null || r.difficulty === q.difficulty),
        );
      pool = valid.filter(matches).map((q) => ({ versionId: q.currentVersion!.id, points: q.currentVersion!.points }));
    }
    return { problems: [...problems], pool };
  }

  async publish(auth: RequestAuth, id: string) {
    await this.db.$transaction(async (tx) => {
      const test = await this.find(auth, id, tx);
      if (test.status !== "DRAFT") throw new AppError("CONFLICT", 409, { reason: "TEST_PUBLISHED" });
      const { problems, pool } = await this.check(auth, test, tx);
      if (problems.length) throw new AppError("VALIDATION_ERROR", 400, { reason: "TEST_INVALID", problems });
      const now = new Date();
      const { timezone } = await schoolClock(tx as unknown as Db);
      let maxScore = test.maxScore.toString();
      if (test.format === "ONLINE") {
        // The frozen question set: the chosen questions (MANUAL) or every question a pool rule may draw (POOL).
        await tx.testQuestion.deleteMany({ where: { testId: id } });
        await tx.testQuestion.createMany({
          data: pool.map((p, order) => ({
            tenantId: requireTenantId(),
            testId: id,
            questionVersionId: p.versionId,
            order,
            points: p.points,
          })),
        });
        const selection = test.selection as TestSelection;
        const everyone = selection.mode === "MANUAL" && !test.questionCount;
        if (everyone) maxScore = sum(pool.map((p) => p.points.toString())).toString();
      }
      const status = test.format === "ONLINE" && test.startsAt && test.startsAt > now ? "SCHEDULED" : "OPEN";
      await tx.test.update({
        where: { id },
        data: {
          status,
          publishedAt: now,
          maxScore,
          schoolDate: test.schoolDate ?? schoolDateToDb(toSchoolDate(test.startsAt ?? now, timezone)),
        },
      });
      await scheduleStatusJobs(tx, test);
      await writeAudit(tx, { action: "test.publish", entityType: "Test", entityId: id, after: { status } });
    });
    return this.get(auth, id);
  }

  async close(auth: RequestAuth, id: string) {
    await this.db.$transaction(async (tx) => {
      const test = await this.find(auth, id, tx);
      if (test.status === "DRAFT" || test.status === "CLOSED" || test.status === "ARCHIVED")
        throw new AppError("CONFLICT", 409, { reason: "TEST_NOT_OPEN" });
      await tx.test.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
      await writeAudit(tx, { action: "test.close", entityType: "Test", entityId: id });
    });
    return this.get(auth, id);
  }

  /** A DRAFT is deleted; a published test is archived (its attempts and results stay). */
  async remove(auth: RequestAuth, id: string) {
    await this.db.$transaction(async (tx) => {
      const test = await this.find(auth, id, tx);
      if (test.status === "DRAFT") {
        await tx.test.delete({ where: { id } });
        await writeAudit(tx, { action: "test.delete", entityType: "Test", entityId: id });
        return;
      }
      if (test.status !== "CLOSED") throw new AppError("CONFLICT", 409, { reason: "TEST_NOT_CLOSED" });
      await tx.test.update({ where: { id }, data: { status: "ARCHIVED" } });
      await writeAudit(tx, { action: "test.archive", entityType: "Test", entityId: id });
    });
  }
}

/** DB checks of the test row surface as a 400 naming the rule, not a 500. */
function constraintToValidation(err: unknown): unknown {
  const message = err instanceof Error ? err.message : "";
  for (const [constraint, path] of [
    ["Test_window_check", "endsAt"],
    ["Test_weighted_check", "periodId"],
    ["Test_offline_scale_check", "maxScore"],
  ] as const)
    if (message.includes(constraint))
      return new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code: "invalid" }] });
  return err;
}
