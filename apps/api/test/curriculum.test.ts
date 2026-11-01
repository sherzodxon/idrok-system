// M2 step 4: topics, plan versions and the approval flow (acceptance 11 for plans, 12).
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

const teacher1 = () => api(t, s.teacher1);
const items = [
  { topicTitle: "Kasrlar", hours: 2 },
  { topicTitle: "O'nli kasrlar", hours: 1, lessonType: "PRACTICE" as const, homework: "1–5-misollar" },
  { topicTitle: "Nazorat ishi", hours: 1, lessonType: "CONTROL_WORK" as const },
];
const newPlan = (who = teacher1(), over: object = {}) =>
  who.post("/curriculum-plans", {
    academicYearId: s.year.id,
    subjectId: s.math.id,
    gradeId: s.g7.id,
    title: "Matematika 7-sinf",
    items,
    ...over,
  });

describe("writing plans", () => {
  it("a teacher writes a plan for their own subject and grade; topics are matched by normalised title", async () => {
    const plan = await newPlan();
    expect(plan).toMatchObject({ version: 1, status: "DRAFT", itemCount: 3, totalHours: 4, canEdit: true });
    expect(plan.authorName).toContain("Ustoz Bir");
    expect(plan.items.map((i: { order: number }) => i.order)).toEqual([1, 2, 3]);
    // The same title in another plan (different spacing/case) reuses the topic.
    const again = await newPlan(teacher1(), { title: "Ikkinchi", items: [{ topicTitle: "  kasrlar ", hours: 1 }] });
    expect(again.items[0].topicId).toBe(plan.items[0].topicId);
    const topics = await teacher1().get(`/topics?subjectId=${s.math.id}&gradeId=${s.g7.id}`);
    expect(topics.map((x: { title: string }) => x.title).sort()).toEqual(["Kasrlar", "Nazorat ishi", "O'nli kasrlar"]);
  });

  it("acceptance 11 (plans): not for another subject or grade, and not someone else's plan", async () => {
    const english = await teacher1().raw("post", "/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.english.id,
      gradeId: s.g7.id,
      title: "X",
      items: [],
    });
    expect(english.status).toBe(403);
    const grade4 = await teacher1().raw("post", "/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g4.id,
      title: "X",
      items: [],
    });
    expect(grade4.status).toBe(403);
    const plan = await newPlan();
    // Teacher 2 also teaches maths in grade 7 (7-B), but the plan is teacher 1's.
    const other = await api(t, s.teacher2).raw("put", `/curriculum-plans/${plan.id}`, { title: "Boshqa" });
    expect(other.status).toBe(403);
    expect((await api(t, s.teacher2).get(`/curriculum-plans/${plan.id}`)).canEdit).toBe(false);
  });

  it("validates items: a topic id must belong to the subject and grade, hours ≥ 1", async () => {
    const res = await teacher1().raw("post", "/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "X",
      items: [{ topicTitle: "A", hours: 0 }],
    });
    expect(res.status).toBe(400);
    const both = await teacher1().raw("post", "/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "X",
      items: [{ hours: 1 }],
    });
    expect(both.body.error.details.fields[0].code).toBe("topic_required");
  });
});

describe("approval and versions", () => {
  it("submit → approve; an approved plan is changed only through a new version (acceptance 12)", async () => {
    const v1 = await newPlan();
    const submitted = await teacher1().post(`/curriculum-plans/${v1.id}/submit`);
    expect(submitted.status).toBe("SUBMITTED");
    expect((await teacher1().raw("post", `/curriculum-plans/${v1.id}/approve`)).status).toBe(403);
    const approved = await s.a.post(`/curriculum-plans/${v1.id}/approve`);
    expect(approved).toMatchObject({ status: "APPROVED" });

    const edit = await teacher1().raw("put", `/curriculum-plans/${v1.id}`, { title: "O'zgargan" });
    expect(edit.body.error.details.reason).toBe("PLAN_NOT_EDITABLE");

    const v2 = await teacher1().post(`/curriculum-plans/${v1.id}/new-version`);
    expect(v2).toMatchObject({ version: 2, status: "DRAFT", lineageId: v1.lineageId, itemCount: 3 });
    const twice = await teacher1().raw("post", `/curriculum-plans/${v1.id}/new-version`);
    expect(twice.body.error.details.reason).toBe("PLAN_HAS_OPEN_VERSION");
    await teacher1().put(`/curriculum-plans/${v2.id}`, { items: [...items, { topicTitle: "Takrorlash", hours: 1 }] });
    // Until v2 is approved, v1 stays the approved one.
    expect((await teacher1().get(`/curriculum-plans/${v1.id}`)).status).toBe("APPROVED");

    await teacher1().post(`/curriculum-plans/${v2.id}/submit`);
    const rejected = await s.a.post(`/curriculum-plans/${v2.id}/reject`, { note: "Nazorat ishi oxirida bo'lsin" });
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionNote: "Nazorat ishi oxirida bo'lsin" });
    const reopened = await teacher1().put(`/curriculum-plans/${v2.id}`, { title: "Matematika 7 (tuzatilgan)" });
    expect(reopened.status).toBe("DRAFT");
    await teacher1().post(`/curriculum-plans/${v2.id}/submit`);
    await s.a.post(`/curriculum-plans/${v2.id}/approve`);

    const after = await teacher1().get(`/curriculum-plans/${v2.id}`);
    expect(after.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([
      [2, "APPROVED"],
      [1, "ARCHIVED"],
    ]);
  });

  it("an empty plan cannot be submitted; without required approval it is approved at once", async () => {
    const empty = await newPlan(teacher1(), { items: [] });
    expect((await teacher1().raw("post", `/curriculum-plans/${empty.id}/submit`)).body.error.details.reason).toBe(
      "PLAN_EMPTY",
    );
    await s.a.put("/settings/school", { planApprovalRequired: false });
    const plan = await newPlan();
    expect((await teacher1().post(`/curriculum-plans/${plan.id}/submit`)).status).toBe("APPROVED");
    await s.a.put("/settings/school", { planApprovalRequired: true });
  });

  it("the list hides archived versions and filters by author", async () => {
    const mine = await teacher1().get(`/curriculum-plans?mine=true&pageSize=100`);
    expect(mine.items.every((p: { status: string }) => p.status !== "ARCHIVED")).toBe(true);
    expect(mine.total).toBeGreaterThan(0);
    const teacher2Mine = await api(t, s.teacher2).get(`/curriculum-plans?mine=true`);
    expect(teacher2Mine.total).toBe(0);
    expect((await api(t, s.guardian).raw("get", "/curriculum-plans")).status).toBe(403);
  });
});
