// M3 step 4: assessment policies (versions, publish checks, default preset), bindings and grade scales (§5.6, §6).
import { DEFAULT_ASSESSMENT_CONFIG } from "@idrok/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
const period = (name: string, order: number, startDate: string, endDate: string) =>
  s.a.post(`/academic-years/${s.year.id}/periods`, { type: "QUARTER", name, order, startDate, endDate });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
}, 120_000);
afterAll(() => t.close());

describe("policies", () => {
  it("the default preset exists, published, with the spec defaults", async () => {
    const [policy] = await s.a.get("/assessment/policies");
    expect(policy).toMatchObject({ isDefault: true, versions: [{ version: 1, status: "PUBLISHED" }] });
    const version = await s.a.get(`/assessment/versions/${policy.versions[0].id}`);
    expect(version.config).toEqual(DEFAULT_ASSESSMENT_CONFIG);
    // The 5-point scale is there but not selected (Q-13).
    const scales = await s.a.get("/grade-scales");
    expect(scales.map((x: { name: string }) => x.name)).toContain("5 ballik");
    expect(version.config.gradeScaleId).toBeNull();
    // A second listing does not create another default.
    expect(await s.a.get("/assessment/policies")).toHaveLength(1);
  });

  it("acceptance 11: components 50 + 40 ≠ 100 → publish refused; a valid draft publishes and retires the old", async () => {
    const [policy] = await s.a.get("/assessment/policies");
    const bad = {
      ...DEFAULT_ASSESSMENT_CONFIG,
      components: [
        DEFAULT_ASSESSMENT_CONFIG.components[0]!,
        { ...DEFAULT_ASSESSMENT_CONFIG.components[1]!, maxPoints: "40" },
      ],
    };
    expect((await s.a.post("/assessment/validate", bad)).problems).toEqual(["COMPONENTS_SUM_MISMATCH"]);
    const draft = await s.a.put(`/assessment/policies/${policy.id}/draft`, { config: bad, note: "60/40 sinov" });
    expect(draft).toMatchObject({ version: 2, status: "DRAFT" });
    const refused = await s.a.raw("post", `/assessment/versions/${draft.id}/publish`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.details).toMatchObject({
      reason: "POLICY_INVALID",
      problems: ["COMPONENTS_SUM_MISMATCH"],
    });

    const scale = (await s.a.get("/grade-scales"))[0];
    const good = {
      ...bad,
      components: [bad.components[0]!, { ...bad.components[1]!, maxPoints: "50" }],
      gradeScaleId: scale.id,
    };
    // Saving again updates the same draft.
    expect((await s.a.put(`/assessment/policies/${policy.id}/draft`, { config: good })).id).toBe(draft.id);
    const published = await s.a.post(`/assessment/versions/${draft.id}/publish`);
    expect(published.status).toBe("PUBLISHED");
    const versions = (await s.a.get("/assessment/policies"))[0].versions;
    expect(versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([
      [2, "PUBLISHED"],
      [1, "RETIRED"],
    ]);
    // Published scale bands can no longer change.
    const changed = await s.a.raw("put", `/grade-scales/${scale.id}`, {
      name: scale.name,
      bands: [
        { minPercent: "0", maxPercent: "50", label: "2" },
        { minPercent: "50", maxPercent: "100", label: "5" },
      ],
    });
    expect(changed.body.error.details.reason).toBe("SCALE_IN_USE");
    expect((await s.a.put(`/grade-scales/${scale.id}`, { name: "5 ballik (asosiy)", bands: scale.bands })).name).toBe(
      "5 ballik (asosiy)",
    );
  });

  it("acceptance 15: a gap between bands → refused", async () => {
    const res = await s.a.raw("post", "/grade-scales", {
      name: "Bo'shliqli",
      bands: [
        { minPercent: "0", maxPercent: "50", label: "2" },
        { minPercent: "60", maxPercent: "100", label: "5" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.problems).toContain("GAP_OR_OVERLAP");
  });

  it("only assessment managers change policies; teachers can read them", async () => {
    const teacher = api(t, s.teacher1);
    expect((await teacher.raw("get", "/assessment/policies")).status).toBe(200);
    expect((await teacher.raw("post", "/assessment/policies", { name: "Meniki" })).status).toBe(403);
    expect((await api(t, s.guardian).raw("get", "/assessment/policies")).status).toBe(403);
  });
});

describe("bindings", () => {
  it("activating a period binds the default version; changing it on an active period needs a reason", async () => {
    const q1 = await period("1-chorak", 1, "2026-09-01", "2026-10-25");
    await s.a.post(`/periods/${q1.id}/activate`);
    const [binding] = await s.a.get(`/periods/${q1.id}/policy-bindings`);
    const policies = await s.a.get("/assessment/policies");
    const current = policies[0].versions.find((v: { status: string }) => v.status === "PUBLISHED");
    expect(binding).toMatchObject({ subjectId: null, policyVersionId: current.id, supersededAt: null });

    const other = await s.a.post("/assessment/policies", { name: "Matematika uchun" });
    await s.a.post(`/assessment/versions/${other.id}/publish`);
    // A subject binding is new: no reason needed. Replacing the all-subjects one is.
    await s.a.post(`/periods/${q1.id}/bind-policy`, { policyVersionId: other.id, subjectId: s.math.id });
    const noReason = await s.a.raw("post", `/periods/${q1.id}/bind-policy`, { policyVersionId: other.id });
    expect(noReason.status).toBe(400);
    await s.a.post(`/periods/${q1.id}/bind-policy`, { policyVersionId: other.id, reason: "Maktab qarori" });
    const bindings = await s.a.get(`/periods/${q1.id}/policy-bindings`);
    expect(bindings.filter((b: { supersededAt: string | null }) => !b.supersededAt)).toHaveLength(2);
    expect(bindings.find((b: { supersededAt: string | null }) => b.supersededAt)).toMatchObject({
      policyVersionId: current.id,
    });
    // A draft cannot be bound.
    const draft = await s.a.put(`/assessment/policies/${other.policyId}/draft`, { config: DEFAULT_ASSESSMENT_CONFIG });
    expect(
      (await s.a.raw("post", `/periods/${q1.id}/bind-policy`, { policyVersionId: draft.id, reason: "x x x" })).status,
    ).toBe(400);
  });
});
