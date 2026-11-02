// M4 step 2: the question bank (tests.md §3) — versions, sharing, export (acceptance 19), Excel import
// (acceptance 16), images and test types.
import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";
import { startTestWorker, waitForImport } from "./support/worker";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let worker: Awaited<ReturnType<typeof startTestWorker>> | null = null;
let loops: { id: string };

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024", STORAGE_LOCAL_DIR: `.data/test-storage-${process.pid}-bank` });
  s = await buildSchool(t, t.defaultTenant);
  loops = await t.deps.root.topic.create({
    data: {
      tenantId: t.defaultTenant.tenant.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "Sikllar",
      normalizedTitle: "sikllar",
    },
  });
  worker = await startTestWorker(t);
}, 180_000);
afterAll(async () => {
  await worker?.stop();
  await t.close();
  rmSync(t.env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
});

const teacher1 = () => api(t, s.teacher1);
const teacher2 = () => api(t, s.teacher2);
const single = (text: string, correct = "b") => ({
  type: "SINGLE",
  text,
  subjectId: s.math.id,
  gradeId: s.g7.id,
  options: ["a", "b", "c"].map((id) => ({ id, text: id.toUpperCase(), isCorrect: id === correct })),
});
const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });

describe("questions", () => {
  it("create, validate, edit as a new version; metadata edits keep the version", async () => {
    const bad = await teacher1().raw("post", "/question-bank/questions", {
      ...single("Ikki to'g'ri?"),
      options: [
        { id: "a", text: "1", isCorrect: true },
        { id: "b", text: "2", isCorrect: true },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.problems).toEqual(["SINGLE_NEEDS_ONE_CORRECT"]);
    const otherSubjectTopic = await teacher1().raw("post", "/question-bank/questions", {
      ...single("Mavzu?"),
      subjectId: s.english.id,
      topicId: loops.id,
    });
    expect(otherSubjectTopic.status).toBe(400);

    const q = await teacher1().post("/question-bank/questions", { ...single("2+2?"), topicId: loops.id, points: 2 });
    expect(q).toMatchObject({ mine: true, topicTitle: "Sikllar", current: { version: 1, points: "2" } });
    const edited = await teacher1().patch(`/question-bank/questions/${q.id}`, {
      content: { text: "2 + 2 = ?", points: 2, options: q.current.options },
    });
    expect(edited.current.version).toBe(2);
    const same = await teacher1().patch(`/question-bank/questions/${q.id}`, {
      content: { text: "2 + 2 = ?", points: "2", options: q.current.options },
      difficulty: "HARD",
    });
    expect(same.current.version).toBe(2);
    expect(same.difficulty).toBe("HARD");
    const versions = await teacher1().get(`/question-bank/questions/${q.id}/versions`);
    expect(versions.map((v: { version: number; text: string }) => [v.version, v.text])).toEqual([
      [2, "2 + 2 = ?"],
      [1, "2+2?"],
    ]);
  });

  it("other types are checked too: MULTIPLE, SHORT_TEXT, MATCHING", async () => {
    await teacher1().post("/question-bank/questions", {
      type: "SHORT_TEXT",
      text: "O'zbekiston poytaxti?",
      subjectId: s.math.id,
      gradeId: s.g7.id,
      acceptedAnswers: ["Toshkent"],
      options: [{ id: "a", text: "ignored", isCorrect: true }],
    });
    const matching = await teacher1().post("/question-bank/questions", {
      type: "MATCHING",
      text: "Moslang",
      subjectId: s.math.id,
      gradeId: s.g7.id,
      pairs: [
        { leftId: "l1", left: "2+2", rightId: "r1", right: "4" },
        { leftId: "l2", left: "3+3", rightId: "r2", right: "6" },
      ],
    });
    expect(matching.current.options).toEqual([]);
    const noKey = await teacher1().raw("post", "/question-bank/questions", {
      type: "MULTIPLE",
      text: "?",
      subjectId: s.math.id,
      gradeId: s.g7.id,
      options: [
        { id: "a", text: "1", isCorrect: false },
        { id: "b", text: "2", isCorrect: false },
      ],
    });
    expect(noKey.status).toBe(400);
  });

  it("sharing: a colleague of the subject sees a shared question but cannot edit it; others never", async () => {
    const q = await teacher1().post("/question-bank/questions", single("Ulashilgan?"));
    const ids = async (who: typeof teacher1) =>
      (await who().get("/question-bank/questions?pageSize=100")).items.map((x: { id: string }) => x.id);
    expect(await ids(teacher2)).not.toContain(q.id);
    expect((await teacher2().raw("get", `/question-bank/questions/${q.id}`)).status).toBe(404);
    await teacher1().patch(`/question-bank/questions/${q.id}`, { sharedWithSubject: true });
    expect(await ids(teacher2)).toContain(q.id);
    const seen = await teacher2().get(`/question-bank/questions/${q.id}`);
    expect(seen.mine).toBe(false);
    const edit = await teacher2().raw("patch", `/question-bank/questions/${q.id}`, { difficulty: "EASY" });
    expect(edit.status).toBe(403);
    // The admin sees every question (school-wide) but edits none of them.
    expect((await s.a.raw("patch", `/question-bank/questions/${q.id}`, { difficulty: "EASY" })).status).toBe(403);
    // Students and guardians have no bank at all.
    expect((await api(t, s.guardian).raw("get", "/question-bank/questions")).status).toBe(403);
  });

  it("archived questions leave the default list", async () => {
    const q = await teacher1().post("/question-bank/questions", single("Arxiv?"));
    await teacher1().patch(`/question-bank/questions/${q.id}`, { status: "ARCHIVED" });
    const active = await teacher1().get("/question-bank/questions?pageSize=100&q=Arxiv");
    const archived = await teacher1().get("/question-bank/questions?pageSize=100&q=Arxiv&status=ARCHIVED");
    expect(active.total).toBe(0);
    expect(archived.items[0].id).toBe(q.id);
  });
});

describe("export and import (§3)", () => {
  it("acceptance 19: export only with questions.export — guardians 403; a teacher exports only their own", async () => {
    const q = `subjectId=${s.math.id}&gradeId=${s.g7.id}`;
    expect((await api(t, s.guardian).raw("get", `/question-bank/export?${q}`)).status).toBe(403);
    expect((await teacher1().raw("get", `/question-bank/export?${q}&scope=all`)).status).toBe(403);
    const res = await binary(request(t.app).get(`/api/v1/question-bank/export?${q}`).set(s.teacher1));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    const texts: string[] = [];
    sheet.eachRow((row, n) => n > 2 && texts.push(String(row.getCell(keys.indexOf("question") + 1).value)));
    expect(texts).toContain("2 + 2 = ?");
    expect(texts).not.toContain("Moslang"); // MATCHING is not exported
    const correctOf = (text: string) => {
      let value = "";
      sheet.eachRow((row) => {
        if (String(row.getCell(keys.indexOf("question") + 1).value) === text)
          value = String(row.getCell(keys.indexOf("correct") + 1).value);
      });
      return value;
    };
    expect(correctOf("2 + 2 = ?")).toBe("B");
  });

  it("acceptance 16: import preview marks duplicates and wrong answers; commit adds the rest to the bank", async () => {
    const tpl = await binary(request(t.app).get("/api/v1/question-bank/template").set(s.teacher1));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    const rows: Record<string, string>[] = [
      { question: "Import 1?", optionA: "1", optionB: "2", correct: "A", questionTopic: "Sikllar" },
      { question: "2 + 2 = ?", optionA: "A", optionB: "B", optionC: "C", correct: "B" }, // already in the bank
      { question: "Xato?", optionA: "1", optionB: "2", optionC: "3", optionD: "4", correct: "G" },
      { question: "Import 2?", questionType: "Qisqa javob", correct: "o'n; 10", questionTopic: "Yo'q mavzu" },
    ];
    rows.forEach((values, i) => {
      for (const [key, value] of Object.entries(values))
        sheet.getRow(3 + i).getCell(keys.indexOf(key) + 1).value = value;
    });
    const up = await request(t.app)
      .post("/api/v1/question-bank/import")
      .set(s.teacher1)
      .field("options", JSON.stringify({ subjectId: s.math.id, gradeId: s.g7.id }))
      .attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "savollar.xlsx");
    expect(up.status, JSON.stringify(up.body)).toBe(202);
    const job = await waitForImport(t, s.teacher1, up.body.id, ["PREVIEW_READY", "FAILED"]);
    expect(job.summary).toMatchObject({ total: 4, errors: 1, duplicates: 1 });
    const preview = await teacher1().get(`/imports/${job.id}/rows?pageSize=10`);
    const byRow = new Map(
      preview.items.map((r: { rowNumber: number; status: string; messages: { code: string }[] }) => [r.rowNumber, r]),
    );
    expect(byRow.get(4)).toMatchObject({
      status: "SKIPPED",
      messages: [{ code: "DUPLICATE_QUESTION" }, { code: "NO_TOPIC" }],
    });
    expect(byRow.get(5)).toMatchObject({ status: "ERROR" });
    expect((byRow.get(5) as { messages: { code: string }[] }).messages[0]!.code).toBe("INVALID_CORRECT_ANSWER");
    expect((byRow.get(6) as { messages: { code: string }[] }).messages[0]!.code).toBe("TOPIC_NOT_FOUND");
    // Another teacher does not reach this job.
    expect((await teacher2().raw("get", `/imports/${job.id}`)).status).toBe(404);

    await teacher1().post(`/imports/${job.id}/commit`, { skipErrors: true });
    const done = await waitForImport(t, s.teacher1, job.id, ["COMMITTED", "FAILED"]);
    expect(done.summary).toMatchObject({ created: 2 });
    const list = await teacher1().get("/question-bank/questions?pageSize=100&q=Import");
    expect(list.items.map((q: { current: { text: string } }) => q.current.text).sort()).toEqual([
      "Import 1?",
      "Import 2?",
    ]);
    const first = list.items.find((q: { current: { text: string } }) => q.current.text === "Import 1?");
    expect(first).toMatchObject({ mine: true, topicId: loops.id });
  });
});

describe("images and test types", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

  it("only real images are accepted; a question uses one; others reach it only through the question", async () => {
    const notImage = await request(t.app)
      .post("/api/v1/question-bank/images")
      .set(s.teacher1)
      .attach("file", Buffer.from("hello"), "x.png");
    expect(notImage.status).toBe(400);
    const up = await request(t.app).post("/api/v1/question-bank/images").set(s.teacher1).attach("file", png, "x.png");
    expect(up.status).toBe(201);
    const imageId = up.body.id as string;
    expect((await teacher2().raw("get", `/question-bank/images/${imageId}`)).status).toBe(404);
    await teacher1().post("/question-bank/questions", {
      ...single("Rasmli?"),
      imageAssetId: imageId,
      sharedWithSubject: true,
    });
    const got = await binary(request(t.app).get(`/api/v1/question-bank/images/${imageId}`).set(s.teacher2));
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
  });

  it("system test types appear on first read; only test_types.manage adds more", async () => {
    const list = await teacher1().get("/test-types");
    expect(list.map((x: { code: string }) => x.code)).toEqual(
      expect.arrayContaining(["CHSB", "BSB", "CONTROL_WORK", "TRIAL", "REGULAR"]),
    );
    expect((await teacher1().raw("post", "/test-types", { name: "Olimpiada", code: "OLYMP" })).status).toBe(403);
    const created = await s.a.post("/test-types", { name: "Olimpiada", code: "OLYMP" });
    expect((await s.a.raw("post", "/test-types", { name: "Boshqa", code: "OLYMP" })).status).toBe(409);
    await s.a.patch(`/test-types/${created.id}`, { isActive: false });
    expect((await teacher1().get("/test-types")).map((x: { code: string }) => x.code)).not.toContain("OLYMP");
  });
});
