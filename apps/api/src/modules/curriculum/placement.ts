// Writes a plan's topics onto one group's lessons (lesson-plan.md §4.4, §4.6). Lessons whose topic is fixed — held, or
// in the past (date <= today) with a topic — keep it; every other lesson of the group and subject gets the placement.
import type { DbTransaction } from "@idrok/db";
import { schoolDateFromDb, type SchoolDate } from "@idrok/shared/time";
import { placeTopics, remainingHours, type PlacementWarning } from "../../domain/curriculum";

export interface PlacementResult {
  teachingGroupId: string;
  lessons: number;
  plannedHours: number;
  /** lessons with a topic: fixed ones plus the placed ones */
  placed: number;
  freeLessons: number;
  /** lessons whose planned topic changes */
  changed: { sessionId: string; date: string; lessonNumber: number; from: string | null; to: string | null }[];
  warnings: (PlacementWarning & { topicTitle: string })[];
}

/** Computes the placement; with `write`, stores it. */
export async function placePlanOnGroup(
  tx: DbTransaction,
  input: { planId: string; teachingGroupId: string; subjectId: string; academicYearId: string; today: SchoolDate },
  write: boolean,
): Promise<PlacementResult> {
  const [items, sessions] = await Promise.all([
    tx.planItem.findMany({
      where: { planId: input.planId },
      orderBy: { order: "asc" },
      select: { id: true, topicId: true, hours: true, periodId: true, topic: { select: { title: true } } },
    }),
    tx.lessonSession.findMany({
      where: {
        teachingGroupId: input.teachingGroupId,
        subjectId: input.subjectId,
        academicYearId: input.academicYearId,
        status: { not: "CANCELLED" },
      },
      orderBy: [{ sequenceNo: "asc" }, { date: "asc" }, { lessonNumber: "asc" }],
      select: {
        id: true,
        date: true,
        lessonNumber: true,
        status: true,
        periodId: true,
        planItemId: true,
        planItem: { select: { topicId: true } },
      },
    }),
  ]);
  const fixed = (s: (typeof sessions)[number]) =>
    s.planItemId !== null && (s.status === "HELD" || schoolDateFromDb(s.date) <= input.today);
  const consumed = new Map<string, number>();
  for (const s of sessions)
    if (fixed(s) && s.planItem) consumed.set(s.planItem.topicId, (consumed.get(s.planItem.topicId) ?? 0) + 1);
  const free = sessions.filter((s) => !fixed(s));
  const placement = placeTopics(items, free, remainingHours(items, consumed));

  const changed = free
    .map((s) => ({ s, to: placement.bySession.get(s.id) ?? null }))
    .filter(({ s, to }) => s.planItemId !== to)
    .map(({ s, to }) => ({
      sessionId: s.id,
      date: schoolDateFromDb(s.date),
      lessonNumber: s.lessonNumber,
      from: s.planItemId,
      to,
    }));

  if (write && changed.length) {
    const byTarget = new Map<string | null, string[]>();
    for (const c of changed) byTarget.set(c.to, [...(byTarget.get(c.to) ?? []), c.sessionId]);
    for (const [planItemId, ids] of byTarget)
      await tx.lessonSession.updateMany({ where: { id: { in: ids } }, data: { planItemId } });
  }

  const title = new Map(items.map((i) => [i.id, i.topic.title]));
  return {
    teachingGroupId: input.teachingGroupId,
    lessons: sessions.length,
    plannedHours: items.reduce((sum, i) => sum + i.hours, 0),
    placed: placement.bySession.size + (sessions.length - free.length),
    freeLessons: placement.freeSessions,
    changed,
    warnings: placement.warnings.map((w) => ({ ...w, topicTitle: title.get(w.itemId) ?? "" })),
  };
}

/** Takes the plan's topics off the group's lessons that are not fixed (the plan is no longer applied). */
export async function clearPlanFromGroup(
  tx: DbTransaction,
  input: { teachingGroupId: string; subjectId: string; academicYearId: string; today: SchoolDate },
) {
  const sessions = await tx.lessonSession.findMany({
    where: {
      teachingGroupId: input.teachingGroupId,
      subjectId: input.subjectId,
      academicYearId: input.academicYearId,
      planItemId: { not: null },
      status: { notIn: ["HELD"] },
    },
    select: { id: true, date: true },
  });
  const ids = sessions.filter((s) => schoolDateFromDb(s.date) > input.today).map((s) => s.id);
  if (ids.length) await tx.lessonSession.updateMany({ where: { id: { in: ids } }, data: { planItemId: null } });
}
