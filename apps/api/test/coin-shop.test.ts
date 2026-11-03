// M5 step 3: the Coin Shop — products and pictures, the catalogue, orders under the student's lock (stock and balance
// under concurrent requests), the order flow with refunds, debt and switches.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let student: Record<string, string>;
let other: Record<string, string>;

const key = () => randomUUID();
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082",
  "hex",
);
const credit = (studentId: string, amount: number) =>
  s.a.post("/coins/adjustments", { studentId, amount, reason: "Demo", idempotencyKey: key() });
const balance = async (studentId = s.s7a.id) =>
  (await s.a.get(`/coins/students/${studentId}/summary`)).balance as number;
const order = (who: Record<string, string>, productId: string, idempotencyKey = key()) =>
  api(t, who).raw("post", "/coin-shop/orders", { productId, idempotencyKey });
const settings = (over: Record<string, unknown>) =>
  s.a.get("/coins/settings").then((cur) => s.a.put("/coins/settings", { ...cur, ...over }));

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  student = await studentAuth(t, s, s.s7a.id, t.defaultTenant.tenant.slug);
  other = await studentAuth(t, s, s.s7b.id, t.defaultTenant.tenant.slug);
});
afterAll(() => t.close());

describe("products", () => {
  it("staff manage products and pictures; students see only the visible catalogue", async () => {
    const pen = await s.a.post("/coin-shop/products", { name: "Ruchka", price: 10, stock: 5 });
    const hidden = await s.a.post("/coin-shop/products", { name: "Yashirin", price: 1, stock: 5, isVisible: false });
    const old = await s.a.post("/coin-shop/products", { name: "Eski", price: 1, stock: 5 });
    await s.a.post(`/coin-shop/products/${old.id}/archive`, { archived: true });
    expect((await s.a.raw("post", "/coin-shop/products", { name: "X", price: 0, stock: 1 })).status).toBe(400);

    const upload = await request(t.app)
      .put(`/api/v1/coin-shop/products/${pen.id}/image`)
      .set(s.adminAuthHeaders)
      .attach("file", PNG, "pen.png");
    expect(upload.status).toBe(200);
    expect(upload.body.hasImage).toBe(true);
    const notImage = await request(t.app)
      .put(`/api/v1/coin-shop/products/${pen.id}/image`)
      .set(s.adminAuthHeaders)
      .attach("file", Buffer.from("hello"), "x.png");
    expect(notImage.status).toBe(400);
    const img = await request(t.app).get(`/api/v1/coin-shop/products/${pen.id}/image`).set(student);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    const catalog = await api(t, student).get("/coin-shop/catalog");
    expect(catalog.items.map((i: { name: string }) => i.name)).toEqual(["Ruchka"]);
    expect(catalog).toMatchObject({ balance: 0, canOrder: true, blockedReason: null });
    expect(catalog.items[0]).toMatchObject({ affordable: false, hasImage: true });
    expect(hidden.isVisible).toBe(false);
    // Teachers do not manage the shop; students cannot list all products.
    expect(
      (await api(t, s.teacher1).raw("post", "/coin-shop/products", { name: "Y", price: 1, stock: 1 })).status,
    ).toBe(403);
    expect((await api(t, student).raw("get", "/coin-shop/products")).status).toBe(403);
  });
});

describe("orders", () => {
  let product: { id: string };

  it("takes the price and the stock at once; a repeated key returns the first order", async () => {
    product = await s.a.post("/coin-shop/products", { name: "Daftar", price: 15, stock: 2 });
    expect((await order(student, product.id)).body.error).toMatchObject({
      code: "COIN_INSUFFICIENT_BALANCE",
      details: { balance: 0 },
    });
    await credit(s.s7a.id, 40);
    const idempotencyKey = key();
    const first = await order(student, product.id, idempotencyKey);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ balance: 25, duplicate: false, order: { status: "PENDING", price: 15 } });
    const again = await order(student, product.id, idempotencyKey);
    expect(again.body).toMatchObject({ balance: 25, duplicate: true, order: { id: first.body.order.id } });
    expect((await order(other, product.id, idempotencyKey)).status).toBe(409);
    const tx = await s.a.get(`/coins/transactions?studentId=${s.s7a.id}&type=PURCHASE`);
    expect(tx.items[0]).toMatchObject({ amount: -15, orderId: first.body.order.id, balanceAfter: 25 });
    expect((await s.a.get("/coin-shop/products")).find((p: { id: string }) => p.id === product.id).stock).toBe(1);
  });

  it("the student cancels a pending order and gets the coins and the stock back", async () => {
    const mine = await api(t, student).get("/coin-shop/my-orders");
    const id = mine.items[0].id;
    // Another student cannot touch it.
    expect((await api(t, other).raw("post", `/coin-shop/orders/${id}/cancel`, {})).status).toBe(404);
    const cancelled = await api(t, student).post(`/coin-shop/orders/${id}/cancel`, {});
    expect(cancelled).toMatchObject({ balance: 40, order: { status: "CANCELLED" } });
    expect(cancelled.order.closedAt).not.toBeNull();
    expect((await api(t, student).raw("post", `/coin-shop/orders/${id}/cancel`, {})).body.error.details.reason).toBe(
      "ORDER_STATUS",
    );
    const refund = await s.a.get(`/coins/transactions?studentId=${s.s7a.id}&type=REFUND`);
    expect(refund.items[0]).toMatchObject({ amount: 15, orderId: id });
    expect((await s.a.get("/coin-shop/products")).find((p: { id: string }) => p.id === product.id).stock).toBe(2);
  });

  it("staff approve and deliver; a rejection refunds; the student cannot approve", async () => {
    const a = (await order(student, product.id)).body.order;
    const b = (await order(student, product.id)).body.order;
    expect(await balance()).toBe(10);
    expect((await api(t, student).raw("post", `/coin-shop/orders/${a.id}/approve`, {})).status).toBe(403);
    expect((await s.a.raw("post", `/coin-shop/orders/${a.id}/deliver`, {})).body.error.details.reason).toBe(
      "ORDER_STATUS",
    );
    await s.a.post(`/coin-shop/orders/${a.id}/approve`, {});
    const delivered = await s.a.post(`/coin-shop/orders/${a.id}/deliver`, { note: "Berildi" });
    expect(delivered.order).toMatchObject({ status: "DELIVERED", note: "Berildi" });
    // Both items are taken.
    expect((await order(student, product.id)).body.error.details.reason).toBe("OUT_OF_STOCK");
    const rejected = await s.a.post(`/coin-shop/orders/${b.id}/reject`, { note: "Tugadi" });
    expect(rejected).toMatchObject({ balance: 25, order: { status: "REJECTED" } });
    const list = await s.a.get("/coin-shop/orders?pageSize=50");
    expect(list.statusCounts).toMatchObject({ DELIVERED: 1, REJECTED: 1, CANCELLED: 1 });
    expect((await api(t, s.teacher1).raw("get", "/coin-shop/orders")).status).toBe(403);
  });

  it("concurrent orders never oversell nor overspend", async () => {
    const last = await s.a.post("/coin-shop/products", { name: "Oxirgi", price: 5, stock: 3 });
    await credit(s.s7b.id, 10);
    // 6 parallel orders of student B (10 coins, 5 each): exactly 2 pass by balance.
    const byB = await Promise.all(Array.from({ length: 6 }, () => order(other, last.id)));
    expect(byB.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await balance(s.s7b.id)).toBe(0);
    // One left in stock: two students race for it, one wins.
    await credit(s.s7b.id, 10);
    const race = await Promise.all([order(student, last.id), order(other, last.id)]);
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect(race.find((r) => r.status !== 200)?.body.error.details.reason).toBe("OUT_OF_STOCK");
    expect((await s.a.get("/coin-shop/products")).find((p: { id: string }) => p.id === last.id).stock).toBe(0);
  });

  it("a student in debt cannot buy; switches close the shop", async () => {
    const cheap = await s.a.post("/coin-shop/products", { name: "Arzon", price: 1, stock: 10 });
    await settings({ allowNegativeBalance: true, maxDebt: 100 });
    const b = await balance(s.s7b.id);
    await s.a.post("/coins/adjustments", {
      studentId: s.s7b.id,
      amount: -(b + 3),
      reason: "Demo",
      idempotencyKey: key(),
    });
    expect((await api(t, other).get("/coin-shop/catalog")).blockedReason).toBe("IN_DEBT");
    expect((await order(other, cheap.id)).body.error.details.reason).toBe("IN_DEBT");
    await settings({ allowNegativeBalance: false, maxDebt: null, newOrdersEnabled: false });
    expect((await order(student, cheap.id)).body.error.details.reason).toBe("ORDERS_PAUSED");
    await settings({ newOrdersEnabled: true, shopEnabled: false });
    expect(await api(t, student).get("/coin-shop/catalog")).toMatchObject({ blockedReason: "SHOP_CLOSED", items: [] });
    await settings({ shopEnabled: true, orderApprovalRequired: false });
    expect((await order(student, cheap.id)).body.order.status).toBe("APPROVED");
    await settings({ orderApprovalRequired: true });
  });
});
