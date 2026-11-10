// M7: bot webhook (secret, idempotent), linking (contact / one-time code / unlink), Mini App login (initData HMAC),
// guardian notifications (dedupe, preferences, quiet hours, rate limit, blocked bot), broadcasts, permissions and
// tenant isolation. Telegram itself is a fake client; worker processors are called directly.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runWithTenant } from "@idrok/db";
import { schoolDateToDb, schoolMinuteOfDay, schoolToday } from "@idrok/shared/time";
import { signInitData } from "../src/domain/telegram";
import { FakeTelegramClient, TelegramApiError } from "../src/infra/telegram";
import { deliverNotification } from "../src/modules/notifications/deliver";
import { emitAttendanceEvents, processArrival, sendDailyDigests } from "../src/modules/notifications/sources";
import { processTelegramUpdate } from "../src/modules/telegram/bot";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

const BOT_TOKEN = "123456789:AAtest-only-token-not-a-secret-000000";
const SECRET = "test-only-webhook-secret-0123456789abcdef";
const GUARDIAN_PHONE = "998905551122"; // Telegram sends contacts without "+"

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let b: Awaited<ReturnType<typeof buildSchool>>;
let tenantA: string;
const fake = new FakeTelegramClient();
let updateId = 1000;

const inA = <T>(fn: () => Promise<T>) => runWithTenant({ tenantId: tenantA, requestId: "test" }, fn);

async function hook(update: Record<string, unknown>, secret = SECRET) {
  return request(t.app).post("/api/v1/telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", secret).send(update);
}

/** Webhook + the worker step. Returns the replies sent to that chat. */
async function say(from: number, message: Record<string, unknown>) {
  fake.sent.length = 0;
  const id = ++updateId;
  const res = await hook({
    update_id: id,
    message: {
      message_id: id,
      chat: { id: from, type: "private" },
      from: { id: from, language_code: "uz" },
      ...message,
    },
  });
  expect(res.status).toBe(200);
  const row = await t.deps.root.telegramUpdate.findFirstOrThrow({ where: { tenantId: tenantA, updateId: BigInt(id) } });
  await inA(() =>
    processTelegramUpdate(
      {
        db: t.deps.db,
        redis: t.deps.redis,
        telegram: fake,
        authState: t.deps.authState,
        logger: t.deps.logger,
        miniAppUrl: "https://app.example.test/tg",
      },
      row.id,
    ),
  );
  return fake.sent.map((m) => m.text).join("\n");
}

const initData = (userId: number, authDate = Math.floor(Date.now() / 1000)) =>
  signInitData(
    {
      auth_date: String(authDate),
      query_id: "AAE",
      user: JSON.stringify({ id: userId, first_name: "Demo", language_code: "uz" }),
    },
    BOT_TOKEN,
  );
const miniLogin = (data: string) => request(t.app).post("/api/v1/auth/telegram").send({ initData: data });

async function deliverPending() {
  const pending = await t.deps.root.notification.findMany({ where: { tenantId: tenantA, status: "PENDING" } });
  for (const n of pending)
    await inA(() =>
      deliverNotification({ db: t.deps.db, telegram: fake, sms: t.deps.sms, logger: t.deps.logger }, n.id),
    );
  return pending.length;
}

beforeAll(async () => {
  t = await createTestApp({
    ARGON2_MEMORY_KIB: "1024",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_BOT_USERNAME: "idrok_demo_bot",
  });
  t.deps.telegram = fake;
  tenantA = t.defaultTenant.tenant.id;
  s = await buildSchool(t, t.defaultTenant);
  b = await buildSchool(t, await t.createTenant());
});
afterAll(() => t.close());
beforeEach(() => {
  fake.fail = null;
});

describe("feature switch", () => {
  it("with a token and a webhook secret the UI is told Telegram is on", async () => {
    expect((await api(t, s.guardian).get("/me")).features).toEqual({ telegram: true });
  });

  it("without them the bot answers nothing and /me says off", async () => {
    const off = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
    try {
      const res = await request(off.app)
        .post("/api/v1/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
        .send({ update_id: 1 });
      expect(res.status).toBe(404);
      const init = await request(off.app)
        .post("/api/v1/auth/telegram")
        .send({ initData: "auth_date=1&hash=x", tenant: off.defaultTenant.tenant.slug });
      expect(init.status === 404 || init.body.error?.code === "VALIDATION_ERROR").toBe(true);
    } finally {
      await off.close();
    }
  });
});

describe("webhook", () => {
  it("needs the secret header and stores an update once", async () => {
    expect((await hook({ update_id: 1 }, "wrong-secret-wrong-secret-wrong-secret")).status).toBe(401);
    expect((await request(t.app).post("/api/v1/telegram/webhook").send({ update_id: 1 })).status).toBe(401);
    expect((await hook({ update_id: 1 })).status).toBe(200);
    expect((await hook({ update_id: 1 })).status).toBe(200);
    expect(await t.deps.root.telegramUpdate.count({ where: { tenantId: tenantA, updateId: 1n } })).toBe(1);
    expect(
      await t.deps.root.outboxEvent.count({ where: { tenantId: tenantA, type: "telegram.update_received" } }),
    ).toBe(1);
    // Garbage is acknowledged (Telegram would retry it forever), nothing stored.
    expect((await hook({ nope: true })).status).toBe(200);
  });

  it("clears the payload once processed (it may hold a phone number)", async () => {
    await say(7001, { text: "/help" });
    const row = await t.deps.root.telegramUpdate.findFirstOrThrow({
      where: { tenantId: tenantA, updateId: BigInt(updateId) },
    });
    expect(row.processedAt).not.toBeNull();
    expect(row.payload).toBeNull();
  });
});

describe("linking", () => {
  it("/start without a link asks for the contact", async () => {
    const reply = await say(7001, { text: "/start" });
    expect(reply).toContain("telefon raqamingizni");
    expect(fake.sent[0]?.options?.requestContact).toBeDefined();
  });

  it("someone else's contact and an unknown phone do not link", async () => {
    expect(await say(7001, { contact: { phone_number: GUARDIAN_PHONE, user_id: 9999 } })).toContain("o'zingizning");
    expect(await say(7001, { contact: { phone_number: "998901112233", user_id: 7001 } })).toContain("topilmadi");
    expect(await t.deps.root.telegramLink.count({ where: { tenantId: tenantA } })).toBe(0);
  });

  it("the guardian's own contact links (TG-01), audited", async () => {
    const reply = await say(7001, { contact: { phone_number: GUARDIAN_PHONE, user_id: 7001 } });
    expect(reply).toContain("Bog'landi");
    expect(fake.sent.some((m) => m.options?.buttons?.[0]?.web_app?.url === "https://app.example.test/tg")).toBe(true);
    const link = await t.deps.root.telegramLink.findFirstOrThrow({ where: { tenantId: tenantA, revokedAt: null } });
    expect(link).toMatchObject({ guardianId: s.guardianId, method: "CONTACT", telegramUserId: 7001n });
    expect(await t.deps.root.auditLog.count({ where: { tenantId: tenantA, action: "telegram.link" } })).toBe(1);
    expect((await s.a.get("/telegram/summary")).linked).toBe(1);
  });

  it("an admin code links once (TG-02); a new account replaces the old link", async () => {
    const issued = await s.a.post(`/telegram/guardians/${s.guardianId}/link-code`);
    expect(issued.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(issued.deepLink).toBe(`https://t.me/idrok_demo_bot?start=${issued.code}`);
    // Only the hash is stored.
    const stored = await t.deps.root.telegramLinkCode.findFirstOrThrow({ where: { tenantId: tenantA } });
    expect(stored.codeHash).not.toContain(issued.code);
    const list = await s.a.get("/telegram/guardians?status=LINKED");
    expect(list.items[0]).toMatchObject({
      guardianId: s.guardianId,
      status: "LINKED",
      pendingCodeExpiresAt: issued.expiresAt,
    });

    expect(await say(7002, { text: `/start ${issued.code}` })).toContain("Bog'landi");
    const active = await t.deps.root.telegramLink.findMany({ where: { tenantId: tenantA, revokedAt: null } });
    expect(active.map((l) => l.telegramUserId)).toEqual([7002n]);
    expect(await say(7003, { text: `/start ${issued.code}` })).toContain("noto'g'ri");
    expect(await say(7003, { text: issued.code.toLowerCase() })).toContain("noto'g'ri");
  });

  it("bad codes are rate limited per Telegram user", async () => {
    for (let i = 0; i < 5; i++) await say(7004, { text: "ABCDEFGHJK" });
    expect(await say(7004, { text: "ABCDEFGHJK" })).toContain("Juda ko'p");
  });

  it("only telegram.manage issues codes; another school's guardian is not found", async () => {
    expect((await api(t, s.teacher1).raw("post", `/telegram/guardians/${s.guardianId}/link-code`)).status).toBe(403);
    expect((await api(t, s.guardian).raw("get", "/telegram/guardians")).status).toBe(403);
    expect((await b.a.raw("post", `/telegram/guardians/${s.guardianId}/link-code`)).status).toBe(404);
    expect((await b.a.raw("delete", `/telegram/guardians/${s.guardianId}/link`)).status).toBe(404);
    expect((await b.a.get("/telegram/guardians")).items.map((g: { guardianId: string }) => g.guardianId)).not.toContain(
      s.guardianId,
    );
    expect((await b.a.get("/telegram/summary")).linked).toBe(0);
  });
});

describe("Mini App login", () => {
  it("verified initData of a linked account opens a TELEGRAM session without a password (TG-03)", async () => {
    const res = await miniLogin(initData(7002));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ mustChangePassword: false, profiles: { guardianId: s.guardianId } });
    const bearer = { Authorization: `Bearer ${res.body.tokens.accessToken}` };
    const kids = await request(t.app).get("/api/v1/me/children").set(bearer);
    expect(kids.status).toBe(200);
    expect(kids.body.map((k: { id: string }) => k.id)).toEqual([s.s7b.id]);
    const session = await t.deps.root.authSession.findFirstOrThrow({
      where: { clientType: "TELEGRAM", revokedAt: null },
    });
    expect(session.telegramLinkId).not.toBeNull();
    // Refresh keeps it a Telegram session.
    const refreshed = await request(t.app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: res.body.tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    const me = await request(t.app)
      .get("/api/v1/me")
      .set({ Authorization: `Bearer ${refreshed.body.tokens.accessToken}` });
    expect(me.body.mustChangePassword).toBe(false);
  });

  it("forged, stale and unlinked initData are refused", async () => {
    const forged = initData(7002).replace("first_name%22%3A%22Demo", "first_name%22%3A%22Evil");
    expect((await miniLogin(forged)).body.error.code).toBe("TELEGRAM_INVALID_INIT_DATA");
    const old = initData(7002, Math.floor(Date.now() / 1000) - 2 * 86_400);
    expect((await miniLogin(old)).status).toBe(401);
    expect((await miniLogin(signInitData({ auth_date: "1", user: "{}" }, "1:other-bot-token"))).status).toBe(401);
    const unlinked = await miniLogin(initData(7001));
    expect(unlinked.status).toBe(403);
    expect(unlinked.body.error.code).toBe("TELEGRAM_NOT_LINKED");
  });

  it("a password login with clientType TELEGRAM does not skip the temporary password", async () => {
    const tg = await request(t.app)
      .post("/api/v1/auth/login")
      .send({ username: s.guardianUsername, password: "Yangi-demo-77", clientType: "TELEGRAM" });
    expect(tg.status).toBe(200);
    const session = await t.deps.root.authSession.findUniqueOrThrow({
      where: { refreshTokenHash: (await import("../src/modules/auth/tokens")).hashToken(tg.body.tokens.refreshToken) },
    });
    expect(session.telegramLinkId).toBeNull();
  });
});

describe("notifications", () => {
  const today = schoolToday();
  const arrive = async (studentId: string, at = new Date()) => {
    await t.deps.root.attendanceRecord.upsert({
      where: { tenantId_studentId_schoolDate: { tenantId: tenantA, studentId, schoolDate: schoolDateToDb(today) } },
      create: {
        tenantId: tenantA,
        studentId,
        schoolDate: schoolDateToDb(today),
        firstInAt: at,
        deviceStatus: "PRESENT",
      },
      update: { firstInAt: at, deviceStatus: "PRESENT" },
    });
    return inA(() => processArrival(t.deps.db, studentId, today));
  };
  const settings = (body: Record<string, unknown>) => s.a.put("/telegram/settings", body);
  const allDay = { quietStartMinute: 0, quietEndMinute: 0 }; // equal ends = no quiet hours

  it("an arrival reaches the linked guardian once (TG-04)", async () => {
    await settings(allDay);
    expect(await arrive(s.s7b.id)).toBe(1);
    expect(await arrive(s.s7b.id)).toBe(0); // same event, no second message
    expect(await arrive(s.s7a.id)).toBe(0); // not this guardian's child
    expect(await deliverPending()).toBe(1);
    expect(fake.sent.at(-1)).toMatchObject({ chatId: "7002" });
    expect(fake.sent.at(-1)?.text).toContain("maktabga keldi");
    const n = await t.deps.root.notification.findFirstOrThrow({ where: { tenantId: tenantA, kind: "ARRIVAL" } });
    expect(n.status).toBe("SENT");
  });

  it("respects the guardian's switch, quiet hours and the hourly limit", async () => {
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    await api(t, s.guardian).put("/portal/notifications", { arrival: false });
    expect(await arrive(s.s7b.id)).toBe(0);
    await api(t, s.guardian).put("/portal/notifications", { arrival: true });

    const minute = schoolMinuteOfDay(new Date());
    await settings({ quietStartMinute: minute, quietEndMinute: (minute + 120) % 1440 });
    expect(await arrive(s.s7b.id)).toBe(1);
    const deferred = await t.deps.root.notification.findFirstOrThrow({ where: { tenantId: tenantA, kind: "ARRIVAL" } });
    expect(deferred.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);

    await settings({ ...allDay, maxPerGuardianPerHour: 1 });
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    await t.deps.root.notification.createMany({
      data: ["a", "b"].map((k) => ({
        tenantId: tenantA,
        guardianId: s.guardianId,
        kind: "ARRIVAL" as const,
        dedupeKey: `test:${k}`,
        params: { student: "Demo", time: "08:00", late: 0 },
      })),
    });
    await deliverPending();
    const rows = await t.deps.root.notification.findMany({
      where: { tenantId: tenantA },
      orderBy: { dedupeKey: "asc" },
    });
    expect(rows.map((r) => [r.status, r.skipReason])).toEqual([
      ["SENT", null],
      ["SKIPPED", "RATE_LIMITED"],
    ]);
    await settings({ maxPerGuardianPerHour: 10 });
  });

  it("a blocked bot marks the link and stops sending", async () => {
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    await t.deps.root.notification.create({
      data: { tenantId: tenantA, guardianId: s.guardianId, kind: "ARRIVAL", dedupeKey: "blocked", params: {} },
    });
    fake.fail = new TelegramApiError(403, "Forbidden: bot was blocked by the user");
    await deliverPending();
    const n = await t.deps.root.notification.findFirstOrThrow({ where: { tenantId: tenantA, dedupeKey: "blocked" } });
    expect(n).toMatchObject({ status: "SKIPPED", skipReason: "BLOCKED" });
    expect((await s.a.get("/telegram/guardians?status=BLOCKED")).total).toBe(1);
    // Writing to the bot again unblocks.
    fake.fail = null;
    await say(7002, { text: "/help" });
    expect((await s.a.get("/telegram/guardians?status=LINKED")).total).toBe(1);
  });

  it("portal: the guardian sees their settings and link; staff cannot use the portal endpoint", async () => {
    const mine = await api(t, s.guardian).get("/portal/notifications");
    expect(mine.telegram).toMatchObject({ status: "LINKED", botUsername: "idrok_demo_bot" });
    expect(mine.preferences.arrival).toBe(true);
    expect((await s.a.raw("get", "/portal/notifications")).status).toBe(403);
    expect((await api(t, s.guardian).raw("put", "/portal/notifications", { quietStartMinute: 60 })).status).toBe(400);
  });
});

describe("broadcasts (TG-06)", () => {
  it("preview counts, sends only to the selected class, keeps a history", async () => {
    expect(await s.a.post("/telegram/broadcasts/preview", { classGroupIds: [s.c7b.id] })).toEqual({
      students: 1,
      guardians: 1,
      reachable: 1,
    });
    expect((await s.a.post("/telegram/broadcasts/preview", { classGroupIds: [s.c7a.id] })).guardians).toBe(0);
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    const none = await s.a.post("/telegram/broadcasts", { classGroupIds: [s.c7a.id], text: "7-A uchun" });
    expect(none.recipientCount).toBe(0);
    const sent = await s.a.post("/telegram/broadcasts", {
      classGroupIds: [s.c7b.id],
      text: "Ertaga ota-onalar majlisi",
    });
    expect(sent).toMatchObject({ recipientCount: 1, pending: 1, classGroups: [s.c7b.name] });
    fake.sent.length = 0;
    await deliverPending();
    expect(fake.sent.map((m) => m.text)).toEqual([expect.stringContaining("Ertaga ota-onalar majlisi")]);
    const history = await s.a.get("/telegram/broadcasts");
    expect(history.items[0]).toMatchObject({ id: sent.id, sent: 1, pending: 0 });
    expect(await t.deps.root.auditLog.count({ where: { tenantId: tenantA, action: "notifications.broadcast" } })).toBe(
      2,
    );
  });

  it("needs notifications.broadcast; another school's classes are refused", async () => {
    expect(
      (await api(t, s.teacher1).raw("post", "/telegram/broadcasts", { classGroupIds: [s.c7b.id], text: "x" })).status,
    ).toBe(403);
    expect((await api(t, s.guardian).raw("get", "/telegram/broadcasts")).status).toBe(403);
    expect((await b.a.raw("post", "/telegram/broadcasts/preview", { classGroupIds: [s.c7b.id] })).status).toBe(400);
    expect((await b.a.get("/telegram/broadcasts")).total).toBe(0);
  });
});

describe("daily digest", () => {
  it("today's coins reach the guardian once, after the digest time", async () => {
    await s.a.put("/telegram/settings", { digestMinute: 0, quietStartMinute: 0, quietEndMinute: 0 });
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    await s.a.post("/coins/adjustments", {
      studentId: s.s7b.id,
      amount: 15,
      reason: "Olimpiada",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(await inA(() => sendDailyDigests(t.deps.db))).toBe(1);
    expect(await inA(() => sendDailyDigests(t.deps.db))).toBe(0);
    fake.sent.length = 0;
    await deliverPending();
    expect(fake.sent[0]?.text).toContain("Coin: +15");
    await s.a.put("/telegram/settings", { digestMinute: 23 * 60 + 59 });
    expect(await inA(() => sendDailyDigests(t.deps.db))).toBe(0);
  });
});

describe("unlinking (TG-05)", () => {
  it("/unlink ends the link and its Mini App sessions; messages stop", async () => {
    const login = await miniLogin(initData(7002));
    const bearer = { Authorization: `Bearer ${login.body.tokens.accessToken}` };
    expect((await request(t.app).get("/api/v1/me").set(bearer)).status).toBe(200);
    expect(await say(7002, { text: "/unlink" })).toContain("uzildi");
    expect((await request(t.app).get("/api/v1/me").set(bearer)).status).toBe(401);
    expect((await miniLogin(initData(7002))).status).toBe(403);
    await t.deps.root.notification.deleteMany({ where: { tenantId: tenantA } });
    await t.deps.root.attendanceRecord.deleteMany({ where: { tenantId: tenantA } });
    expect(await inA(() => processArrival(t.deps.db, s.s7b.id, schoolToday()))).toBe(0);
    expect(await say(7002, { text: "/unlink" })).toContain("bog'lanmagansiz");
  });

  it("the admin can unlink too", async () => {
    const code = (await s.a.post(`/telegram/guardians/${s.guardianId}/link-code`)).code as string;
    await say(7005, { text: code });
    expect((await s.a.raw("delete", `/telegram/guardians/${s.guardianId}/link`)).status).toBe(204);
    expect((await s.a.raw("delete", `/telegram/guardians/${s.guardianId}/link`)).status).toBe(404);
    expect((await s.a.get("/telegram/summary")).linked).toBe(0);
  });
});

describe("attendance events", () => {
  it("today's first arrival and a new exit become outbox events; other days and repeats do not", async () => {
    const today = schoolToday();
    const at = new Date();
    const count = (type: string) => t.deps.root.outboxEvent.count({ where: { tenantId: tenantA, type } });
    const [arrivals, departures] = [await count("notify.arrival"), await count("notify.departure")];
    const emit = (
      input: Omit<Parameters<typeof emitAttendanceEvents>[1], "studentId" | "today" | "departureDelayMinutes">,
    ) =>
      inA(() =>
        t.deps.db.$transaction((tx) =>
          emitAttendanceEvents(tx, { studentId: s.s7b.id, today, departureDelayMinutes: 10, ...input }),
        ),
      );
    await emit({ date: today, before: null, after: { firstInAt: at, lastOutAt: null } });
    await emit({ date: today, before: { firstInAt: at, lastOutAt: null }, after: { firstInAt: at, lastOutAt: null } });
    await emit({ date: "2026-09-01" as typeof today, before: null, after: { firstInAt: at, lastOutAt: at } });
    await emit({ date: today, before: { firstInAt: at, lastOutAt: null }, after: { firstInAt: at, lastOutAt: at } });
    expect(await count("notify.arrival")).toBe(arrivals + 1);
    expect(await count("notify.departure")).toBe(departures + 1);
    const dep = await t.deps.root.outboxEvent.findFirstOrThrow({
      where: { tenantId: tenantA, type: "notify.departure" },
      orderBy: { createdAt: "desc" },
    });
    expect(dep.availableAt.getTime()).toBeGreaterThanOrEqual(at.getTime() + 9 * 60_000);
  });
});
