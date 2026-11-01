// M2 step 1: periods, school week, calendar days, shifts, rooms, bell schedules.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
}, 120_000);
afterAll(() => t.close());

const yearPath = () => `/academic-years/${s.year.id}`;

describe("periods", () => {
  let q1: { id: string };

  it("creates quarters inside the year and nests them in halves", async () => {
    const half = await s.a.post(`${yearPath()}/periods`, {
      type: "HALF",
      name: "1-yarim yil",
      order: 1,
      startDate: "2026-09-01",
      endDate: "2026-12-28",
    });
    q1 = await s.a.post(`${yearPath()}/periods`, {
      type: "QUARTER",
      name: "1-chorak",
      order: 1,
      startDate: "2026-09-01",
      endDate: "2026-10-31",
      parentId: half.id,
    });
    expect(q1).toMatchObject({ status: "DRAFT", parentId: half.id, startDate: "2026-09-01" });
    const list = await s.a.get(`${yearPath()}/periods`);
    expect(list).toHaveLength(2);
  });

  it("rejects overlapping quarters, dates outside the year or the parent", async () => {
    const overlap = await s.a.raw("post", `${yearPath()}/periods`, {
      type: "QUARTER",
      name: "2-chorak",
      order: 2,
      startDate: "2026-10-31",
      endDate: "2026-12-28",
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details.reason).toBe("PERIOD_OVERLAP");
    const outside = await s.a.raw("post", `${yearPath()}/periods`, {
      type: "CUSTOM",
      name: "Yozgi",
      order: 1,
      startDate: "2027-07-01",
      endDate: "2027-07-10",
    });
    expect(outside.status).toBe(400);
    expect(outside.body.error.details.fields[0].code).toBe("outside_academic_year");
    const backwards = await s.a.raw("post", `${yearPath()}/periods`, {
      type: "CUSTOM",
      name: "X",
      order: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-01",
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details.fields[0].code).toBe("end_before_start");
  });

  it("fixes the dates once a period is active", async () => {
    await s.a.post(`/periods/${q1.id}/activate`);
    const res = await s.a.raw("patch", `/periods/${q1.id}`, { endDate: "2026-11-01" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("PERIOD_NOT_DRAFT");
    expect((await s.a.patch(`/periods/${q1.id}`, { name: "I chorak" })).name).toBe("I chorak");
  });
});

describe("school week", () => {
  it("defaults to Monday–Saturday and can be changed", async () => {
    expect(await s.a.get(`${yearPath()}/school-week`)).toMatchObject({
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      configured: false,
    });
    const week = await s.a.put(`${yearPath()}/school-week`, { workingWeekdays: [5, 1, 2, 3, 4] });
    expect(week).toMatchObject({ workingWeekdays: [1, 2, 3, 4, 5], configured: true });
    const bad = await s.a.raw("put", `${yearPath()}/school-week`, { workingWeekdays: [1, 1] });
    expect(bad.status).toBe(400);
  });
});

describe("calendar days", () => {
  it("marks a holiday, a vacation range and a working Saturday", async () => {
    const [holiday] = await s.a.post(`${yearPath()}/calendar-days`, {
      date: "2026-10-01",
      kind: "HOLIDAY",
      title: "O'qituvchilar kuni",
    });
    expect(holiday).toMatchObject({ kind: "HOLIDAY", appliesToAll: true, followsWeekday: null });
    const vacation = await s.a.post(`${yearPath()}/calendar-days`, {
      from: "2026-11-02",
      to: "2026-11-08",
      kind: "VACATION",
      title: "Kuzgi ta'til",
    });
    expect(vacation).toHaveLength(7);
    const [saturday] = await s.a.post(`${yearPath()}/calendar-days`, {
      date: "2026-10-10",
      kind: "WORKING_OVERRIDE",
      title: "Dushanba jadvali",
      followsWeekday: 1,
    });
    expect(saturday.followsWeekday).toBe(1);
    const october = await s.a.get(`${yearPath()}/calendar-days?from=2026-10-01&to=2026-10-31`);
    expect(october.map((d: { date: string }) => d.date)).toEqual(["2026-10-01", "2026-10-10"]);
  });

  it("applies a day to some grades only", async () => {
    const [day] = await s.a.post(`${yearPath()}/calendar-days`, {
      date: "2026-12-01",
      kind: "NON_WORKING",
      title: "7-sinflar sayohati",
      gradeIds: [s.g7.id],
    });
    expect(day).toMatchObject({ appliesToAll: false, gradeIds: [s.g7.id] });
    const all = await s.a.patch(`/calendar-days/${day.id}`, { gradeIds: [] });
    expect(all).toMatchObject({ appliesToAll: true, gradeIds: [] });
  });

  it("rejects duplicates, a missing followsWeekday and dates outside the year", async () => {
    const dup = await s.a.raw("post", `${yearPath()}/calendar-days`, {
      from: "2026-10-30",
      to: "2026-11-03",
      kind: "VACATION",
      title: "X",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toMatchObject({ reason: "DAY_EXISTS", dates: ["2026-11-02", "2026-11-03"] });
    const noFollow = await s.a.raw("post", `${yearPath()}/calendar-days`, {
      date: "2026-10-17",
      kind: "WORKING_OVERRIDE",
      title: "X",
    });
    expect(noFollow.status).toBe(400);
    expect(noFollow.body.error.details.fields[0].code).toBe("follows_weekday_rule");
    const outside = await s.a.raw("post", `${yearPath()}/calendar-days`, {
      date: "2027-08-01",
      kind: "HOLIDAY",
      title: "X",
    });
    expect(outside.status).toBe(400);
  });

  it("unmarks a day and audits every change", async () => {
    const [day] = await s.a.post(`${yearPath()}/calendar-days`, {
      date: "2027-03-08",
      kind: "HOLIDAY",
      title: "8-mart",
    });
    await s.a.raw("delete", `/calendar-days/${day.id}`);
    const left = await s.a.get(`${yearPath()}/calendar-days?from=2027-03-08&to=2027-03-08`);
    expect(left).toEqual([]);
    const logs = await s.a.get("/audit-logs?action=calendar_day&pageSize=50");
    expect(logs.items.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining(["calendar_day.create", "calendar_day.update", "calendar_day.delete"]),
    );
  });
});

describe("shifts, bell schedules and rooms", () => {
  it("two shifts with their own bells; a class follows a shift", async () => {
    const first = await s.a.post("/shifts", { name: "1-smena", startTime: "08:00", endTime: "13:00" });
    const second = await s.a.post("/shifts", { name: "2-smena", startTime: "13:30", endTime: "18:30" });
    expect(first).toMatchObject({ startTime: "08:00", endTime: "13:00", archived: false });

    const bells = await s.a.post(`${yearPath()}/bell-schedules`, {
      name: "1-smena qo'ng'iroqlari",
      shiftId: first.id,
      validFrom: "2026-09-01",
      slots: [
        { lessonNumber: 2, startTime: "08:55", endTime: "09:40" },
        { lessonNumber: 1, startTime: "08:00", endTime: "08:45" },
      ],
    });
    expect(bells.slots.map((x: { lessonNumber: number }) => x.lessonNumber)).toEqual([1, 2]);
    await s.a.post(`${yearPath()}/bell-schedules`, {
      name: "2-smena qo'ng'iroqlari",
      shiftId: second.id,
      validFrom: "2026-09-01",
      slots: [{ lessonNumber: 1, startTime: "13:30", endTime: "14:15" }],
    });
    const again = await s.a.raw("post", `${yearPath()}/bell-schedules`, {
      name: "X",
      shiftId: first.id,
      validFrom: "2026-09-01",
      slots: [{ lessonNumber: 1, startTime: "08:00", endTime: "08:45" }],
    });
    expect(again.body.error.details.reason).toBe("BELL_SCHEDULE_EXISTS");
    const overlapping = await s.a.raw("post", `${yearPath()}/bell-schedules`, {
      name: "X",
      validFrom: "2026-09-01",
      slots: [
        { lessonNumber: 1, startTime: "08:00", endTime: "08:50" },
        { lessonNumber: 2, startTime: "08:45", endTime: "09:30" },
      ],
    });
    expect(overlapping.status).toBe(400);
    expect(overlapping.body.error.details.fields[0].code).toBe("overlaps_previous");

    const cls = await s.a.patch(`/class-groups/${s.c7a.id}`, { shiftId: second.id });
    expect(cls.shiftId).toBe(second.id);
    const archive = await s.a.raw("patch", `/shifts/${second.id}`, { archived: true });
    expect(archive.body.error.details.reason).toBe("SHIFT_IN_USE");
  });

  it("rooms are unique per school", async () => {
    await s.a.post("/rooms", { name: "101", capacity: 30 });
    const dup = await s.a.raw("post", "/rooms", { name: "101" });
    expect(dup.status).toBe(409);
    expect((await s.a.get("/rooms")).map((r: { name: string }) => r.name)).toContain("101");
  });
});

describe("access", () => {
  it("teachers read the calendar but cannot change it", async () => {
    const teacher = api(t, s.teacher1);
    expect((await teacher.get(`${yearPath()}/periods`)).length).toBeGreaterThan(0);
    expect((await teacher.raw("post", "/shifts", { name: "X", startTime: "08:00", endTime: "09:00" })).status).toBe(
      403,
    );
    expect((await teacher.raw("put", `${yearPath()}/school-week`, { workingWeekdays: [1] })).status).toBe(403);
  });

  it("guardians and anonymous callers cannot read it", async () => {
    expect((await api(t, s.guardian).raw("get", `${yearPath()}/periods`)).status).toBe(403);
    expect((await request(t.app).get(`/api/v1${yearPath()}/periods`)).status).toBe(401);
  });

  it("another school's year is not found", async () => {
    const other = await t.createTenant();
    const admin = await other.createUser("SCHOOL_ADMIN");
    const { bearerFor } = await import("./support/school");
    const b = api(t, await bearerFor(t, admin.username, undefined, other.tenant.slug));
    expect((await b.raw("get", `${yearPath()}/periods`)).status).toBe(404);
    expect(
      (
        await b.raw("post", `${yearPath()}/periods`, {
          type: "CUSTOM",
          name: "X",
          order: 9,
          startDate: "2026-09-01",
          endDate: "2026-09-02",
        })
      ).status,
    ).toBe(404);
  });
});
