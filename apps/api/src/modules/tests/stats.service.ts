// Test statistics (tests.md §8): per test (summary, distribution, finish reasons, groups, the previous test), per
// question (correct share, option choices), per topic (student × topic mastery; a group's hardest topics), a student's
// test history and the Excel export. Arithmetic is in domain/tests (summarize, topicMastery).
import ExcelJS from "exceljs";
import type { Db, Prisma } from "@idrok/db";
import {
  importLabelsRu,
  importLabelsUz,
  type QuestionStatsDto,
  type TestHistoryItemDto,
  type TestStatsDto,
  type TopicMasteryDto,
} from "@idrok/shared";
import { D, type Decimal } from "@idrok/shared/decimal";
import { schoolDateFromDb } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { notFound } from "../../http/errors";
import { offlinePercent, resultVisibility, summarize, topicMastery, type QuestionOption } from "../../domain/tests";
import { activeOn, resolveScope, studentWhere } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { TestsService } from "./tests.service";

const str = (d: Decimal | null | undefined) => (d === null || d === undefined ? null : d.toString());

interface Counted {
  studentId: string;
  score: Decimal | null;
  maxScore: Decimal | null;
  percent: Decimal | null;
  attempts: number;
  finishReason: string | null;
  offlineStatus: string | null;
  attemptId: string | null;
}

/** The result that counts per student: LAST / BEST of the finished attempts (online), the current one (offline). */
async function countedResults(
  db: Db,
  test: { id: string; format: string; retakePolicy: string; maxScore: Prisma.Decimal },
) {
  const out = new Map<string, Counted>();
  if (test.format === "OFFLINE") {
    const rows = await db.offlineResult.findMany({ where: { testId: test.id, supersededById: null } });
    for (const r of rows) {
      const scored = r.status === "SCORED";
      out.set(r.studentId, {
        studentId: r.studentId,
        score: scored ? D(r.rawScore!.toString()) : null,
        maxScore: D(test.maxScore.toString()),
        percent: scored ? offlinePercent(r.rawScore!.toString(), test.maxScore.toString()) : null,
        attempts: 0,
        finishReason: null,
        offlineStatus: r.status,
        attemptId: null,
      });
    }
    return out;
  }
  const attempts = await db.testAttempt.findMany({
    where: { testId: test.id, status: "FINISHED" },
    orderBy: { finishedAt: "asc" },
  });
  for (const a of attempts) {
    const prev = out.get(a.studentId);
    const percent = a.percent ? D(a.percent.toString()) : null;
    const better =
      test.retakePolicy === "BEST" ? !prev?.percent || (percent !== null && percent.gt(prev.percent)) : true;
    const next: Counted = better
      ? {
          studentId: a.studentId,
          score: a.score ? D(a.score.toString()) : null,
          maxScore: D(a.maxScore.toString()),
          percent,
          attempts: 0,
          finishReason: a.finishReason,
          offlineStatus: null,
          attemptId: a.id,
        }
      : prev!;
    out.set(a.studentId, { ...next, attempts: (prev?.attempts ?? 0) + 1 });
  }
  return out;
}

export class StatsService {
  private readonly tests: TestsService;
  constructor(private readonly db: Db) {
    this.tests = new TestsService(db);
  }

  /** Students a test is for (named, and members of its groups on the test's day), with their group. */
  private async students(test: Awaited<ReturnType<TestsService["find"]>>) {
    const day = test.schoolDate ? schoolDateFromDb(test.schoolDate) : null;
    const groupIds = test.assignments.flatMap((a) => (a.teachingGroupId ? [a.teachingGroupId] : []));
    const named = test.assignments.flatMap((a) => (a.studentId ? [a.studentId] : []));
    const [members, namedRows] = await Promise.all([
      this.db.teachingGroupMember.findMany({
        where: { teachingGroupId: { in: groupIds }, ...(day ? activeOn(day) : {}) },
        select: { studentId: true, teachingGroupId: true, student: { select: { firstName: true, lastName: true } } },
      }),
      this.db.student.findMany({ where: { id: { in: named } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const out = new Map<string, { name: string; groupId: string | null }>();
    for (const m of members)
      out.set(m.studentId, { name: `${m.student.lastName} ${m.student.firstName}`, groupId: m.teachingGroupId });
    for (const s of namedRows)
      if (!out.has(s.id)) out.set(s.id, { name: `${s.lastName} ${s.firstName}`, groupId: null });
    return out;
  }

  async testStats(auth: RequestAuth, testId: string): Promise<TestStatsDto> {
    const test = await this.tests.find(auth, testId);
    const [students, counted] = await Promise.all([this.students(test), countedResults(this.db, test)]);
    const percents = [...counted.values()].flatMap((c) => (c.percent ? [c.percent] : []));
    const summary = summarize(percents);
    const reasons: Record<string, number> = {};
    for (const c of counted.values()) {
      const key = c.finishReason ?? c.offlineStatus;
      if (key) reasons[key] = (reasons[key] ?? 0) + 1;
    }
    const groups = test.assignments.flatMap((a) => {
      if (!a.teachingGroupId) return [];
      const ps = [...students.entries()]
        .filter(([, s]) => s.groupId === a.teachingGroupId)
        .flatMap(([id]) => (counted.get(id)?.percent ? [counted.get(id)!.percent!] : []));
      return [
        {
          teachingGroupId: a.teachingGroupId,
          name: a.teachingGroup!.name,
          count: ps.length,
          mean: str(summarize(ps).mean),
        },
      ];
    });
    // The previous test of the same teacher, subject and grade (published before this one).
    const previous = await this.db.test.findFirst({
      where: {
        id: { not: testId },
        teacherId: test.teacherId,
        subjectId: test.subjectId,
        gradeId: test.gradeId,
        status: { in: ["OPEN", "CLOSED"] },
        publishedAt: { lt: test.publishedAt ?? new Date() },
      },
      orderBy: { publishedAt: "desc" },
    });
    const previousMean = previous
      ? summarize(
          [...(await countedResults(this.db, previous)).values()].flatMap((c) => (c.percent ? [c.percent] : [])),
        ).mean
      : null;
    return {
      assigned: students.size,
      participants: [...counted.values()].filter((c) => c.percent !== null).length,
      summary: {
        count: summary.count,
        mean: str(summary.mean),
        median: str(summary.median),
        min: str(summary.min),
        max: str(summary.max),
        histogram: summary.histogram,
      },
      finishReasons: reasons,
      groups,
      previous: previous ? { id: previous.id, title: previous.title, mean: str(previousMean) } : null,
      students: [...students.entries()]
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([studentId, s]) => {
          const c = counted.get(studentId);
          return {
            studentId,
            studentName: s.name,
            score: str(c?.score),
            maxScore: str(c?.maxScore),
            percent: str(c?.percent),
            attempts: c?.attempts ?? 0,
            finishReason: c?.finishReason ?? null,
            offlineStatus: c?.offlineStatus ?? null,
          };
        }),
    };
  }

  /** Per question, over the counted attempt of each student. */
  async questionStats(auth: RequestAuth, testId: string): Promise<QuestionStatsDto[]> {
    const test = await this.tests.find(auth, testId);
    const counted = await countedResults(this.db, test);
    const attemptIds = [...counted.values()].flatMap((c) => (c.attemptId ? [c.attemptId] : []));
    const [questions, attempts, answers] = await Promise.all([
      this.db.testQuestion.findMany({
        where: { testId },
        orderBy: { order: "asc" },
        include: { questionVersion: { include: { question: { include: { topic: { select: { title: true } } } } } } },
      }),
      this.db.testAttempt.findMany({ where: { id: { in: attemptIds } }, select: { questionOrder: true } }),
      this.db.testAnswer.findMany({ where: { attemptId: { in: attemptIds } } }),
    ]);
    return questions.map((tq) => {
      const shown = attempts.filter((a) => (a.questionOrder as string[]).includes(tq.id)).length;
      const mine = answers.filter((a) => a.testQuestionId === tq.id);
      const correct = mine.filter((a) => a.isCorrect).length;
      const type = tq.questionVersion.question.type;
      const options =
        type === "SINGLE" || type === "MULTIPLE" ? (tq.questionVersion.options as unknown as QuestionOption[]) : [];
      const share = (n: number) => (shown ? D(n).times(100).dividedBy(shown).toDecimalPlaces(2).toString() : null);
      return {
        testQuestionId: tq.id,
        order: tq.order,
        type,
        text: tq.questionVersion.text,
        topicTitle: tq.questionVersion.question.topic?.title ?? null,
        points: tq.points.toString(),
        shown,
        answered: mine.length,
        correctPercent: share(correct),
        options: options.map((o) => ({
          id: o.id,
          text: o.text,
          isCorrect: o.isCorrect,
          share: share(
            mine.filter((a) => ((a.answer as { optionIds?: string[] }).optionIds ?? []).includes(o.id)).length,
          ),
        })),
      };
    });
  }

  // ---- topics

  /** Points earned and possible per topic over the counted attempts of the given students (unanswered = 0). */
  private async mastery(studentIds: string[], subjectId?: string): Promise<TopicMasteryDto[]> {
    const tests = await this.db.test.findMany({
      where: {
        format: "ONLINE",
        status: { in: ["OPEN", "CLOSED"] },
        attempts: { some: { studentId: { in: studentIds }, status: "FINISHED" } },
        ...(subjectId ? { subjectId } : {}),
      },
      select: {
        id: true,
        format: true,
        retakePolicy: true,
        maxScore: true,
        subjectId: true,
        subject: { select: { name: true } },
      },
    });
    const rows: { topicId: string | null; subjectId: string; points: string; awarded: string }[] = [];
    const titles = new Map<string | null, string | null>();
    const subjects = new Map(tests.map((t) => [t.subjectId, t.subject.name]));
    for (const test of tests) {
      const counted = [...(await countedResults(this.db, test)).values()].filter(
        (c) => studentIds.includes(c.studentId) && c.attemptId,
      );
      const attempts = await this.db.testAttempt.findMany({
        where: { id: { in: counted.map((c) => c.attemptId!) } },
        include: { answers: { select: { testQuestionId: true, pointsAwarded: true } } },
      });
      const tqs = await this.db.testQuestion.findMany({
        where: { testId: test.id },
        include: { questionVersion: { include: { question: { include: { topic: { select: { title: true } } } } } } },
      });
      const byId = new Map(tqs.map((q) => [q.id, q]));
      for (const a of attempts)
        for (const tqId of a.questionOrder as string[]) {
          const tq = byId.get(tqId)!;
          const q = tq.questionVersion.question;
          titles.set(q.topicId, q.topic?.title ?? null);
          rows.push({
            topicId: q.topicId,
            subjectId: test.subjectId,
            points: tq.points.toString(),
            awarded: a.answers.find((x) => x.testQuestionId === tqId)?.pointsAwarded?.toString() ?? "0",
          });
        }
    }
    const out: TopicMasteryDto[] = [];
    for (const subject of new Set(rows.map((r) => r.subjectId))) {
      const ofSubject = rows.filter((r) => r.subjectId === subject);
      for (const [topicId, m] of topicMastery(ofSubject))
        out.push({
          topicId,
          topicTitle: titles.get(topicId) ?? null,
          subjectId: subject,
          subjectName: subjects.get(subject)!,
          earned: m.earned.toString(),
          max: m.max.toString(),
          percent: str(m.percent?.toDecimalPlaces(2)),
          questions: ofSubject.filter((r) => r.topicId === topicId).length,
        });
    }
    return out.sort((a, b) => Number(a.percent ?? 101) - Number(b.percent ?? 101));
  }

  /** A student the caller may see (teacher: own groups; guardian: own child; student: self). */
  private async visibleStudent(auth: RequestAuth, studentId: string) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const found = await this.db.student.findFirst({ where: { AND: [{ id: studentId }, studentWhere(scope, today)] } });
    if (!found) throw notFound();
    return scope;
  }

  async studentMastery(auth: RequestAuth, studentId: string, subjectId?: string) {
    await this.visibleStudent(auth, studentId);
    return this.mastery([studentId], subjectId);
  }

  /** "The hardest topics" of a group: its current members' mastery, weakest first. */
  async groupMastery(auth: RequestAuth, teachingGroupId: string, subjectId: string) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind !== "school" && !(scope.kind === "teacher" && scope.teachingGroupIds.includes(teachingGroupId)))
      throw notFound();
    const members = await this.db.teachingGroupMember.findMany({
      where: { teachingGroupId, ...activeOn(today) },
      select: { studentId: true },
    });
    return this.mastery(
      members.map((m) => m.studentId),
      subjectId,
    );
  }

  /** The student's tests with the counted result; students and guardians see a result only when the test allows. */
  async history(auth: RequestAuth, studentId: string): Promise<TestHistoryItemDto[]> {
    const scope = await this.visibleStudent(auth, studentId);
    const portal = scope.kind === "student" || scope.kind === "guardian";
    const { today } = await schoolClock(this.db);
    const groups = await this.db.teachingGroupMember.findMany({
      where: { studentId, ...activeOn(today) },
      select: { teachingGroupId: true },
    });
    const tests = await this.db.test.findMany({
      where: {
        status: { in: ["OPEN", "CLOSED"] },
        assignments: {
          some: { OR: [{ studentId }, { teachingGroupId: { in: groups.map((g) => g.teachingGroupId) } }] },
        },
      },
      include: {
        subject: { select: { name: true } },
        testType: { select: { name: true } },
        overrides: { select: { endsAt: true, studentId: true } },
      },
      orderBy: [{ schoolDate: "desc" }, { createdAt: "desc" }],
    });
    const now = new Date();
    const out: TestHistoryItemDto[] = [];
    for (const test of tests) {
      const c = (await countedResults(this.db, test)).get(studentId);
      const visible = !portal
        ? true
        : resultVisibility({
            showResultToStudent: test.showResultToStudent,
            testClosed: test.status === "CLOSED",
            endsAt: test.endsAt,
            overrideEnds: test.overrides.map((o) => o.endsAt),
            now,
          }).score;
      const over =
        test.status === "CLOSED" ||
        (test.endsAt !== null &&
          test.endsAt <= now &&
          !test.overrides.some((o) => o.studentId === studentId && o.endsAt > now));
      const status =
        c?.offlineStatus === "EXCUSED"
          ? "EXCUSED"
          : c?.percent
            ? "DONE"
            : c?.offlineStatus === "ABSENT" || (test.format === "ONLINE" && over)
              ? "MISSED"
              : "PENDING";
      out.push({
        testId: test.id,
        title: test.title,
        subjectName: test.subject.name,
        testTypeName: test.testType.name,
        format: test.format,
        purpose: test.purpose,
        date: test.schoolDate ? schoolDateFromDb(test.schoolDate) : null,
        percent: visible ? str(c?.percent?.toDecimalPlaces(2)) : null,
        score: visible ? str(c?.score) : null,
        maxScore: visible ? str(c?.maxScore) : null,
        status,
      });
    }
    return out;
  }

  // ---- export

  async exportResults(auth: RequestAuth, testId: string, locale: "uz" | "ru") {
    const L = (locale === "ru" ? importLabelsRu : importLabelsUz).testExport;
    const stats = await this.testStats(auth, testId);
    const questions = await this.questionStats(auth, testId);
    const wb = new ExcelJS.Workbook();
    const results = wb.addWorksheet(L.results);
    results.columns = [
      { header: L.student, width: 32 },
      { header: L.score, width: 10 },
      { header: L.maxScore, width: 10 },
      { header: L.percent, width: 10 },
      { header: L.attempts, width: 10 },
      { header: L.finish, width: 18 },
    ];
    for (const s of stats.students)
      results.addRow([
        s.studentName,
        s.score ?? "",
        s.maxScore ?? "",
        s.percent ? Number(D(s.percent).toDecimalPlaces(2).toString()) : "",
        s.attempts,
        s.finishReason
          ? L.reasons[s.finishReason as keyof typeof L.reasons]
          : s.offlineStatus
            ? L.offline[s.offlineStatus as keyof typeof L.offline]
            : "",
      ]);
    results.getRow(1).font = { bold: true };
    const qs = wb.addWorksheet(L.questions);
    qs.columns = [
      { header: L.order, width: 6 },
      { header: L.question, width: 60 },
      { header: L.topic, width: 24 },
      { header: L.answered, width: 14 },
      { header: L.correct, width: 16 },
    ];
    for (const q of questions)
      qs.addRow([
        q.order + 1,
        q.text,
        q.topicTitle ?? "",
        q.answered,
        q.correctPercent ? Number(q.correctPercent) : "",
      ]);
    qs.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
