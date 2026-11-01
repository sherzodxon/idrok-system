import { describe, expect, it } from "vitest";
import { findConflicts, weekTypesOverlap, type GroupInfo, type SlotEntry } from "./timetable";

const groups = new Map<string, GroupInfo>([
  ["7a", { id: "7a", kind: "CLASS", classGroupId: "c7a" }],
  ["7a-en1", { id: "7a-en1", kind: "SUBGROUP", classGroupId: "c7a" }],
  ["7a-en2", { id: "7a-en2", kind: "SUBGROUP", classGroupId: "c7a" }],
  ["7b", { id: "7b", kind: "CLASS", classGroupId: "c7b" }],
]);
const e = (p: Partial<SlotEntry>): SlotEntry => ({
  teachingGroupId: "7a",
  teacherId: "t1",
  roomId: null,
  weekday: 1,
  lessonNumber: 1,
  weekType: "ALL",
  ...p,
});

describe("findConflicts", () => {
  it("no conflicts in a normal day", () => {
    expect(
      findConflicts(
        [e({}), e({ lessonNumber: 2 }), e({ teachingGroupId: "7b", teacherId: "t2" }), e({ weekday: 2 })],
        groups,
      ),
    ).toEqual([]);
  });

  it("a teacher in two classes at once", () => {
    expect(findConflicts([e({}), e({ teachingGroupId: "7b" })], groups)).toEqual([
      { kind: "TEACHER_BUSY", weekday: 1, lessonNumber: 1, entries: [0, 1] },
    ]);
  });

  it("a group with two lessons, and a room used twice", () => {
    const kinds = findConflicts([e({ roomId: "r1" }), e({ teacherId: "t2", roomId: "r1" })], groups).map((c) => c.kind);
    expect(kinds).toEqual(["GROUP_BUSY", "ROOM_BUSY"]);
  });

  it("subgroups of one class may run in parallel; the whole class and a subgroup may not", () => {
    expect(
      findConflicts([e({ teachingGroupId: "7a-en1" }), e({ teachingGroupId: "7a-en2", teacherId: "t2" })], groups),
    ).toEqual([]);
    expect(
      findConflicts([e({}), e({ teachingGroupId: "7a-en2", teacherId: "t2" })], groups).map((c) => c.kind),
    ).toEqual(["CLASS_AND_SUBGROUP"]);
  });

  it("odd and even weeks alternate; ALL meets both", () => {
    expect(weekTypesOverlap("ODD", "EVEN")).toBe(false);
    expect(weekTypesOverlap("ALL", "EVEN")).toBe(true);
    expect(findConflicts([e({ weekType: "ODD" }), e({ weekType: "EVEN", teachingGroupId: "7b" })], groups)).toEqual([]);
    expect(findConflicts([e({ weekType: "ODD" }), e({ teachingGroupId: "7b" })], groups)).toHaveLength(1);
  });
});
