import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, bearerFor } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: ReturnType<typeof api>;
let teacherAuth: Record<string, string>;
beforeAll(async () => {
  t = await createTestApp();
  const a = await t.defaultTenant.createUser("SCHOOL_ADMIN");
  admin = api(t, await bearerFor(t, a.username));
  teacherAuth = await bearerFor(t, (await t.defaultTenant.createUser("TEACHER")).username);
});
afterAll(() => t.close());

describe("public branding", () => {
  it("needs no token and returns only names and colours", async () => {
    const res = await request(t.app).get("/api/v1/branding");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["defaultLocale", "defaultThemeMode", "platformName", "primaryColor", "primaryHoverColor", "primarySoftColor", "primaryStrongColor", "schoolName", "secondaryColor"].sort(),
    );
    expect(res.body.primaryColor).toBe("#4E92CF");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("unknown school → 404", async () => {
    expect((await request(t.app).get("/api/v1/branding?tenant=yoq-maktab")).status).toBe(404);
  });
});

describe("branding settings", () => {
  it("a new primary colour derives the other shades and is public right away", async () => {
    const saved = await admin.put("/settings/branding", { primaryColor: "#2E7D32", schoolName: "Demo maktab" });
    expect(saved.branding).toMatchObject({ primaryColor: "#2E7D32", schoolName: "Demo maktab" });
    expect(saved.branding.primaryHoverColor).not.toBe("#397FBF");
    const pub = await request(t.app).get("/api/v1/branding");
    expect(pub.body.primaryColor).toBe("#2E7D32");
    const audit = await t.deps.root.auditLog.findFirst({ where: { action: "settings.branding.update" } });
    expect(audit).not.toBeNull();
  });

  it("warns about low contrast instead of refusing", async () => {
    const saved = await admin.put("/settings/branding", { primaryColor: "#FFEB3B" });
    expect(saved.warnings[0].code).toBe("LOW_CONTRAST");
  });

  it("rejects anything that is not #RRGGBB", async () => {
    const res = await admin.raw("put", "/settings/branding", { primaryColor: "red;}body{display:none" });
    expect(res.status).toBe(400);
  });

  it("teachers cannot change branding", async () => {
    const res = await request(t.app).put("/api/v1/settings/branding").set(teacherAuth).send({ primaryColor: "#000000" });
    expect(res.status).toBe(403);
  });
});

describe("school settings", () => {
  it("validates the timezone and saves", async () => {
    expect((await admin.raw("put", "/settings/school", { timezone: "Mars/Olympus" })).status).toBe(400);
    const saved = await admin.put("/settings/school", { defaultLocale: "ru", studentAccountMinGrade: 6 });
    expect(saved).toMatchObject({ defaultLocale: "ru", studentAccountMinGrade: 6, timezone: "Asia/Tashkent" });
    expect((await request(t.app).get("/api/v1/branding")).body.defaultLocale).toBe("ru");
  });
});
