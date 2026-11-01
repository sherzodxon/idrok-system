// Timetable conflicts (lesson-plan.md §6: a teacher or a group in two places at once). Pure: no database access.

export type WeekType = "ALL" | "ODD" | "EVEN";

export interface SlotEntry {
  teachingGroupId: string;
  teacherId: string;
  roomId: string | null;
  weekday: number;
  lessonNumber: number;
  weekType: WeekType;
}

export interface GroupInfo {
  id: string;
  kind: "CLASS" | "SUBGROUP" | "CROSS_CLASS";
  classGroupId: string | null;
}

export type ConflictKind = "TEACHER_BUSY" | "GROUP_BUSY" | "ROOM_BUSY" | "CLASS_AND_SUBGROUP";

export interface Conflict {
  kind: ConflictKind;
  weekday: number;
  lessonNumber: number;
  /** Indexes into the input list, ascending. */
  entries: [number, number];
}

/** ODD and EVEN lessons alternate, so they never meet; ALL meets both. */
export const weekTypesOverlap = (a: WeekType, b: WeekType) => a === "ALL" || b === "ALL" || a === b;

/**
 * Every pair of entries that cannot happen at the same time:
 * - the same teacher, group or room twice in one slot;
 * - a whole class and one of its subgroups in one slot (the subgroup's students would be in two lessons).
 * Two subgroups of one class at the same time are the normal split and are allowed.
 */
export function findConflicts(entries: SlotEntry[], groups: Map<string, GroupInfo>): Conflict[] {
  const bySlot = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const key = `${e.weekday}:${e.lessonNumber}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), i]);
  });
  const conflicts: Conflict[] = [];
  for (const indexes of bySlot.values()) {
    for (let x = 0; x < indexes.length; x++) {
      for (let y = x + 1; y < indexes.length; y++) {
        const i = indexes[x]!;
        const j = indexes[y]!;
        const a = entries[i]!;
        const b = entries[j]!;
        if (!weekTypesOverlap(a.weekType, b.weekType)) continue;
        const at = { weekday: a.weekday, lessonNumber: a.lessonNumber, entries: [i, j] as [number, number] };
        if (a.teacherId === b.teacherId) conflicts.push({ kind: "TEACHER_BUSY", ...at });
        if (a.teachingGroupId === b.teachingGroupId) conflicts.push({ kind: "GROUP_BUSY", ...at });
        if (a.roomId && a.roomId === b.roomId) conflicts.push({ kind: "ROOM_BUSY", ...at });
        const ga = groups.get(a.teachingGroupId);
        const gb = groups.get(b.teachingGroupId);
        if (
          ga &&
          gb &&
          ga.classGroupId &&
          ga.classGroupId === gb.classGroupId &&
          ((ga.kind === "CLASS" && gb.kind === "SUBGROUP") || (ga.kind === "SUBGROUP" && gb.kind === "CLASS"))
        )
          conflicts.push({ kind: "CLASS_AND_SUBGROUP", ...at });
      }
    }
  }
  return conflicts.sort(
    (p, q) => p.weekday - q.weekday || p.lessonNumber - q.lessonNumber || p.entries[0] - q.entries[0],
  );
}
