import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { CLASSES, studentRows, teacherRows, workbook } from "./support/excel-fixtures";
import { api, bearerFor, buildSchool } from "./support/school";
import { startTestWorker, waitForImport } from "./support/worker";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let worker: Awaited<ReturnType<typeof startTestWorker>> | null = null;
const SUBJECTS = ["Demo fan A", "Demo fan B", "Demo fan C", "Demo fan D"];

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "4096", STORAGE_LOCAL_DIR: `.data/test-storage-${process.pid}` });
  s = await buildSchool(t, t.defaultTenant);
  for (const name of CLASSES) {
    const [level, section] = name.split("-");
    const grade =
      (await s.a.get("/grades")).find((g: { level: number }) => g.level === Number(level)) ??
      (await s.a.post("/grades", { level: Number(level), name: `${level}-sinf` }));
    if (!["4-A", "7-A", "7-B"].includes(name))
      await s.a.post("/class-groups", { academicYearId: s.year.id, gradeId: grade.id, section });
  }
  for (const name of SUBJECTS) await s.a.post("/subjects", { name });
  worker = await startTestWorker(t);
}, 120_000);
afterAll(async () => {
  await worker?.stop();
  await t.close();
  rmSync(t.env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
});

const upload = (kind: string, buffer: Buffer, name = "demo.xlsx", options?: object) => {
  const req = request(t.app).post("/api/v1/imports").set(s.adminAuthHeaders).field("kind", kind);
  if (options) req.field("options", JSON.stringify(options));
  return req.attach("file", buffer, name);
};

describe("templates", () => {
  it("serves uz and ru templates with a hidden key row", async () => {
    for (const locale of ["uz", "ru"] as const) {
      const res = await request(t.app)
        .get(`/api/v1/imports/templates/STUDENTS_GUARDIANS?locale=${locale}`)
        .set(s.adminAuthHeaders)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      const sheet = wb.worksheets[0]!;
      expect(sheet.getRow(1).hidden).toBe(true);
      expect(sheet.getRow(1).getCell(2).value).toBe("lastName");
      expect(sheet.getRow(2).getCell(2).value).toBe(locale === "uz" ? "Familiya*" : "Фамилия*");
    }
  });

  it("requires imports.run", async () => {
    expect((await request(t.app).get("/api/v1/imports/templates/SUBJECTS").set(s.teacher1)).status).toBe(403);
  });
});

describe("upload validation", () => {
  it("rejects files that are not .xlsx", async () => {
    const res = await upload("SUBJECTS", Buffer.from("name\nfoo"), "demo.csv");
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].code).toBe("not_xlsx");
  });

  it("a workbook that is not our template fails with IMPORT_TEMPLATE_MISMATCH", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").getCell(1, 1).value = "Familiya";
    const res = await upload("STUDENTS_GUARDIANS", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(202);
    const job = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["FAILED"]);
    expect(job.failure).toEqual({ code: "IMPORT_TEMPLATE_MISMATCH" });
  });
});

describe("students and guardians (ROADMAP acceptance: 300 students)", () => {
  let importId: string;
  const rows = studentRows(300);
  // Two broken rows, so the preview shows errors.
  rows.push({ lastName: "", firstName: "Demo", className: "7-A" });
  rows.push({
    lastName: "Demo-xato",
    firstName: "Demo",
    className: "11-Z",
    guardian1Phone: "123",
    guardian1LastName: "X",
    guardian1FirstName: "Y",
  });

  it("parses 302 rows into a preview within 30 s, with reasons for errors", async () => {
    const started = Date.now();
    const res = await upload("STUDENTS_GUARDIANS", await workbook("STUDENTS_GUARDIANS", rows), "oquvchilar.xlsx", {
      academicYearId: s.year.id,
    });
    expect(res.status).toBe(202);
    importId = res.body.id;
    const job = await waitForImport(t, s.adminAuthHeaders, importId, ["PREVIEW_READY", "FAILED"]);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(job.status).toBe("PREVIEW_READY");
    expect(job.summary).toMatchObject({ total: 302, errors: 2 });

    const errors = await s.a.get(`/imports/${importId}/rows?status=ERROR`);
    expect(errors.items.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([303, 304]);
    const codes = errors.items.flatMap((r: { messages: { code: string; field?: string }[] }) =>
      r.messages.map((m) => `${m.code}:${m.field}`),
    );
    expect(codes).toEqual(
      expect.arrayContaining(["REQUIRED:lastName", "UNKNOWN_CLASS:className", "INVALID_PHONE:guardian1Phone"]),
    );
  });

  it("refuses to commit while there are errors unless they are skipped", async () => {
    const blocked = await s.a.raw("post", `/imports/${importId}/commit`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.reason).toBe("IMPORT_HAS_ERRORS");
  });

  it("commits once: 300 students, 600 guardians, accounts by grade", async () => {
    const before = await t.deps.root.student.count({ where: { tenantId: t.defaultTenant.tenant.id } });
    const res = await s.a.post(`/imports/${importId}/commit`, { skipErrors: true });
    expect(res.status).toBe("COMMITTING");
    const again = await s.a.raw("post", `/imports/${importId}/commit`, { skipErrors: true });
    expect(again.status).toBe(409);

    const job = await waitForImport(t, s.adminAuthHeaders, importId, ["COMMITTED"], 180_000);
    expect(job.summary).toMatchObject({ created: 300, skipped: 2, failed: 0 });
    const tenantId = t.defaultTenant.tenant.id;
    expect(await t.deps.root.student.count({ where: { tenantId } })).toBe(before + 300);
    expect(
      await t.deps.root.guardian.count({ where: { tenantId, phone: { startsWith: "+99890" } } }),
    ).toBeGreaterThanOrEqual(300);
    // Grade 4 (50 students) gets no logins by default; grades 5–9 (250) do; all 600 new guardians do.
    expect(job.summary.accounts).toBe(250 + 600);
    expect(job.hasCredentials).toBe(true);
  }, 240_000);

  it("the credentials file is downloadable once, by the importing admin only, and the logins work", async () => {
    const other = await t.defaultTenant.createUser("SCHOOL_ADMIN");
    const otherAuth = await bearerFor(t, other.username, undefined, t.defaultTenant.tenant.slug);
    expect((await request(t.app).get(`/api/v1/imports/${importId}/credentials`).set(otherAuth)).status).toBe(403);

    const res = await request(t.app)
      .get(`/api/v1/imports/${importId}/credentials`)
      .set(s.adminAuthHeaders)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.rowCount).toBe(1 + 850);
    const guardianRow = (sheet.getSheetValues() as unknown[][]).find((r) => r?.[1] === "GUARDIAN")!;
    const login = await request(t.app)
      .post("/api/v1/auth/login")
      .send({
        username: String(guardianRow[3]),
        password: String(guardianRow[4]),
        clientType: "MOBILE",
        tenant: t.defaultTenant.tenant.slug,
      });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    const second = await s.a.raw("get", `/imports/${importId}/credentials`);
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe("CREDENTIALS_ALREADY_TAKEN");
  });

  it("re-importing the same file matches existing students instead of duplicating them", async () => {
    const tenantId = t.defaultTenant.tenant.id;
    const before = await t.deps.root.student.count({ where: { tenantId } });
    const res = await upload(
      "STUDENTS_GUARDIANS",
      await workbook("STUDENTS_GUARDIANS", studentRows(300)),
      "qayta.xlsx",
      { academicYearId: s.year.id },
    );
    const preview = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["PREVIEW_READY"]);
    expect(preview.summary).toMatchObject({ warnings: 300, errors: 0 });
    const warn = await s.a.get(`/imports/${res.body.id}/rows?status=WARNING&pageSize=1`);
    expect(warn.items[0].messages[0].code).toBe("MATCHED_EXISTING_STUDENT");
    await s.a.post(`/imports/${res.body.id}/commit`, {});
    const done = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["COMMITTED"], 180_000);
    expect(done.summary).toMatchObject({ created: 0, updated: 300, accounts: 0 });
    expect(await t.deps.root.student.count({ where: { tenantId } })).toBe(before);
  }, 240_000);
});

describe("teachers and assignments (ROADMAP acceptance: 40 teachers)", () => {
  it("imports 40 teachers with roles, homeroom classes and assignments", async () => {
    const res = await upload(
      "EMPLOYEES_ASSIGNMENTS",
      await workbook("EMPLOYEES_ASSIGNMENTS", teacherRows(SUBJECTS)),
      "ustozlar.xlsx",
      { academicYearId: s.year.id },
    );
    const preview = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["PREVIEW_READY"]);
    expect(preview.summary).toMatchObject({ total: 40, errors: 0 });
    await s.a.post(`/imports/${res.body.id}/commit`, {});
    const done = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["COMMITTED"], 120_000);
    expect(done.summary).toMatchObject({ created: 40, accounts: 40 });

    const tenantId = t.defaultTenant.tenant.id;
    const teacher = await t.deps.root.employee.findFirstOrThrow({
      where: { tenantId, employeeCode: "DEMO-T000" },
      include: { user: true },
    });
    expect(await t.deps.root.teacherAssignment.count({ where: { teacherId: teacher.id } })).toBe(2);
    const homeroom = await t.deps.root.classGroup.findFirstOrThrow({
      where: { tenantId, homeroomTeacherId: teacher.id },
    });
    expect(homeroom.name).toBe("4-A");
    const roles = await t.deps.root.userRole.findMany({
      where: { userId: teacher.userId!, revokedAt: null },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.code).sort()).toEqual(["CLASS_TEACHER", "TEACHER"]);
  }, 180_000);
});

describe("worker availability", () => {
  it("an import uploaded while the worker is down waits in the outbox and runs when it is back", async () => {
    await worker!.stop();
    worker = null;
    const res = await upload("SUBJECTS", await workbook("SUBJECTS", [{ name: "Demo kutilgan fan" }]));
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await s.a.get(`/imports/${res.body.id}`)).status).toBe("UPLOADED");
    expect(await t.deps.root.outboxEvent.count({ where: { aggregateId: res.body.id, status: "PENDING" } })).toBe(1);

    worker = await startTestWorker(t);
    const job = await waitForImport(t, s.adminAuthHeaders, res.body.id, ["PREVIEW_READY"]);
    expect(job.summary).toMatchObject({ total: 1, ok: 1 });
  });

  it("a rolled-back transaction leaves no outbox event", async () => {
    const tenantId = t.defaultTenant.tenant.id;
    await expect(
      t.deps.root.$transaction(async (tx) => {
        await tx.outboxEvent.create({
          data: {
            tenantId,
            type: "import.parse_requested",
            aggregateType: "Demo",
            aggregateId: "rollback-demo",
            payload: {},
          },
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await t.deps.root.outboxEvent.count({ where: { aggregateId: "rollback-demo" } })).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("another school cannot see or commit this school's imports", async () => {
    const other = await t.createTenant();
    const otherAdmin = await other.createUser("SCHOOL_ADMIN");
    const auth = await bearerFor(t, otherAdmin.username, undefined, other.tenant.slug);
    const mine = (await s.a.get("/imports")).items[0].id;
    expect((await request(t.app).get(`/api/v1/imports/${mine}`).set(auth)).status).toBe(404);
    expect((await request(t.app).get(`/api/v1/imports/${mine}/rows`).set(auth)).status).toBe(404);
    expect((await request(t.app).post(`/api/v1/imports/${mine}/commit`).set(auth).send({})).status).toBe(404);
    expect((await api(t, auth).get("/imports")).items).toEqual([]);
  });
});
