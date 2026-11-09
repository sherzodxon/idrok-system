// Audit phase 5 (T-75): a student's face is stored only with a guardian consent on record; revoking it removes the
// face in the same transaction; viewing the photo is audited; a revoke racing an upload never leaves a face behind.
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSchoolDays, schoolToday } from "@idrok/shared/time";
import { runWithTenant } from "@idrok/db";
import { cipherFor } from "../src/modules/attendance/attendance.routes";
import { FaceService } from "../src/modules/attendance/face.service";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let photo: Buffer;

const upload = (studentId: string) =>
  request(t.app)
    .put(`/api/v1/face/students/${studentId}/photo`)
    .set(s.adminAuthHeaders)
    .attach("file", photo, { filename: "face.png", contentType: "image/png" });
const consentOf = (studentId: string, body: Record<string, unknown>) =>
  s.a.raw("post", `/face/students/${studentId}/consents`, body);
const audits = (action: string) =>
  t.deps.root.auditLog.count({ where: { tenantId: t.defaultTenant.tenant.id, action } });

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.put("/attendance/settings", { isEnabled: true });
  photo = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#a08070" } })
    .png()
    .toBuffer();
});
afterAll(() => t.close());

describe("consent before a face", () => {
  it("no consent, no face; the school can switch the rule off", async () => {
    const res = await upload(s.s7a.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("FACE_CONSENT_REQUIRED");
    expect((await s.a.get(`/face/students/${s.s7a.id}`)).consent).toBeNull();
    expect((await s.a.get("/attendance/settings")).faceConsentRequired).toBe(true);
    await s.a.put("/attendance/settings", { faceConsentRequired: false });
    expect((await upload(s.s4a.id)).status).toBe(200);
    await s.a.put("/attendance/settings", { faceConsentRequired: true });
  });

  it("a linked guardian's consent takes their name; other guardians, the future and a second one are refused", async () => {
    const own = await consentOf(s.s7b.id, { guardianId: s.guardianId, givenOn: schoolToday() });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ guardianId: s.guardianId, givenBy: "Vasiy Demo", revokedAt: null });
    expect((await consentOf(s.s7a.id, { guardianId: s.guardianId, givenOn: "2026-09-01" })).status).toBe(400);
    expect(
      (await consentOf(s.s7a.id, { givenBy: "Ota", givenOn: addSchoolDays(schoolToday(), 1) })).body.error.details
        .fields[0].code,
    ).toBe("in_future");
    expect((await consentOf(s.s7a.id, { givenOn: "2026-09-01" })).status).toBe(400);
    expect((await consentOf(s.s7b.id, { givenBy: "Ota", givenOn: "2026-09-01" })).body.error.details.reason).toBe(
      "CONSENT_EXISTS",
    );
    expect(
      (
        await api(t, s.teacher1).raw("post", `/face/students/${s.s7a.id}/consents`, {
          givenBy: "X",
          givenOn: "2026-09-01",
        })
      ).status,
    ).toBe(403);
  });

  it("with consent the face is stored; viewing it is on record", async () => {
    expect((await consentOf(s.s7a.id, { givenBy: "Aliyeva Gulnora", givenOn: "2026-09-01" })).status).toBe(200);
    expect((await upload(s.s7a.id)).status).toBe(200);
    const profile = await s.a.get(`/face/students/${s.s7a.id}`);
    expect(profile).toMatchObject({ hasPhoto: true, consent: { givenBy: "Aliyeva Gulnora", givenOn: "2026-09-01" } });
    const before = await audits("face.photo.view");
    await request(t.app).get(`/api/v1/face/students/${s.s7a.id}/photo`).set(s.adminAuthHeaders).expect(200);
    expect(await audits("face.photo.view")).toBe(before + 1);
  });
});

describe("revoking a consent", () => {
  it("needs a reason, removes the face here and keeps the consent as history", async () => {
    const path = `/face/students/${s.s7a.id}/consents/revoke`;
    expect((await s.a.raw("post", path, { reason: "" })).status).toBe(400);
    const after = await s.a.post(path, { reason: "Vasiy rozilikni qaytarib oldi" });
    expect(after).toMatchObject({ hasPhoto: false, consent: null });
    const row = await t.deps.root.faceProfile.findFirstOrThrow({
      where: { studentId: s.s7a.id },
      select: { photoAssetId: true },
    });
    expect(row.photoAssetId).toBeNull();
    const history = await s.a.get(`/face/students/${s.s7a.id}/consents`);
    expect(history).toEqual([
      expect.objectContaining({ givenBy: "Aliyeva Gulnora", revokeReason: "Vasiy rozilikni qaytarib oldi" }),
    ]);
    expect(history[0].revokedAt).not.toBeNull();
    expect(await audits("face.consent.revoke")).toBe(1);
    expect((await upload(s.s7a.id)).body.error.details.reason).toBe("FACE_CONSENT_REQUIRED");
    expect((await s.a.raw("post", path, { reason: "Yana bir bor" })).status).toBe(404);
  });

  it("a revoke racing an upload never leaves a face without consent", async () => {
    await consentOf(s.s7a.id, { givenBy: "Aliyeva Gulnora", givenOn: "2026-09-02" });
    await Promise.all([
      upload(s.s7a.id),
      s.a.raw("post", `/face/students/${s.s7a.id}/consents/revoke`, { reason: "Poyga sinovi" }),
    ]);
    const profile = await s.a.get(`/face/students/${s.s7a.id}`);
    expect(profile.consent).toBeNull();
    expect(profile.hasPhoto).toBe(false);
  });
});

describe("faces stored before the consent rule (Q-54)", () => {
  const sweep = () =>
    runWithTenant({ tenantId: t.defaultTenant.tenant.id }, () =>
      new FaceService(t.deps.db, t.deps.storage, cipherFor(t.deps)).removeWithoutConsent(),
    );

  it("are listed with the deadline; they stay until it passes", async () => {
    // s4a's face was stored while the rule was off (first test).
    const list = await s.a.get("/face/profiles?consent=missing");
    expect(list.items.map((p: { studentId: string }) => p.studentId)).toEqual([s.s4a.id]);
    expect(list).toMatchObject({ noConsent: 1, consentRequired: true, consentGraceEndsOn: null });
    const until = addSchoolDays(schoolToday(), 30);
    await s.a.put("/attendance/settings", { faceConsentGraceEndsOn: until });
    expect((await s.a.get("/face/profiles")).consentGraceEndsOn).toBe(until);
    expect(await sweep()).toBe(0);
    expect((await s.a.get(`/face/students/${s.s4a.id}`)).hasPhoto).toBe(true);
  });

  it("after the deadline, faces without consent are removed; faces with consent stay", async () => {
    await s.a.post(`/face/students/${s.s7a.id}/consents`, { givenBy: "Aliyeva Gulnora", givenOn: "2026-09-03" });
    expect((await upload(s.s7a.id)).status).toBe(200);
    await s.a.put("/attendance/settings", { faceConsentGraceEndsOn: addSchoolDays(schoolToday(), -1) });
    expect(await sweep()).toBe(1);
    expect((await s.a.get(`/face/students/${s.s4a.id}`)).hasPhoto).toBe(false);
    expect((await s.a.get(`/face/students/${s.s7a.id}`)).hasPhoto).toBe(true);
    expect(await audits("face.consent.expired")).toBe(1);
    expect(await sweep()).toBe(0);
  });

  it("nothing is removed while the rule is off", async () => {
    await s.a.put("/attendance/settings", { faceConsentRequired: false });
    expect((await upload(s.s4a.id)).status).toBe(200);
    expect(await sweep()).toBe(0);
    await s.a.put("/attendance/settings", { faceConsentRequired: true });
  });
});
