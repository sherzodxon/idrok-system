// Coin Shop (MASTER_SPEC §14): products, the student's catalogue and orders PENDING → APPROVED → DELIVERED, with
// REJECTED / CANCELLED giving the coins back (a REFUND row) and the item back to stock.
//
// An order takes the student's coin lock, then the stock with a guarded decrement, then the balance (never below zero:
// a student in debt cannot buy) — all in one transaction with the PURCHASE row and the audit entry.
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  CoinOrderQuerySchema,
  CoinOrderStatus,
  CreateCoinOrderSchema,
  UpsertCoinProductSchema,
} from "@idrok/shared";
import { canTransition, refundsOn } from "../../domain/coins";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import type { StorageProvider } from "../../infra/storage";
import { storageKey } from "../../infra/storage/storage";
import { schoolClock } from "../access/school-clock";
import { resolveScope } from "../access/scope";
import { writeAudit } from "../audit/audit.service";
import { imageType, MAX_IMAGE_BYTES } from "../question-bank/question-bank.service";
import { balanceOf, coinSettings, coinsOff, lockStudentCoins, post } from "./ledger";

const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });

const productSelect = {
  id: true,
  name: true,
  description: true,
  imageAssetId: true,
  price: true,
  stock: true,
  isVisible: true,
  archivedAt: true,
} satisfies Prisma.CoinProductSelect;
type ProductRow = Prisma.CoinProductGetPayload<{ select: typeof productSelect }>;

const productDto = (p: ProductRow) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  hasImage: p.imageAssetId !== null,
  price: p.price,
  stock: p.stock,
  isVisible: p.isVisible,
  archived: p.archivedAt !== null,
});

const orderSelect = {
  id: true,
  studentId: true,
  student: {
    select: {
      firstName: true,
      lastName: true,
      enrollments: { where: { status: "ACTIVE" }, select: { classGroup: { select: { name: true } } }, take: 1 },
    },
  },
  productId: true,
  product: { select: { imageAssetId: true } },
  productNameSnapshot: true,
  priceAtOrder: true,
  status: true,
  note: true,
  createdAt: true,
  approvedAt: true,
  deliveredAt: true,
  closedAt: true,
} satisfies Prisma.CoinOrderSelect;
type OrderRow = Prisma.CoinOrderGetPayload<{ select: typeof orderSelect }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const orderDto = (o: OrderRow) => ({
  id: o.id,
  studentId: o.studentId,
  studentName: `${o.student.lastName} ${o.student.firstName}`,
  className: o.student.enrollments[0]?.classGroup.name ?? null,
  productId: o.productId,
  productName: o.productNameSnapshot,
  hasImage: o.product.imageAssetId !== null,
  price: o.priceAtOrder,
  status: o.status,
  note: o.note,
  createdAt: o.createdAt.toISOString(),
  approvedAt: iso(o.approvedAt),
  deliveredAt: iso(o.deliveredAt),
  closedAt: iso(o.closedAt),
});

export class ShopService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageProvider,
  ) {}

  private async me(auth: RequestAuth) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind !== "student") throw forbidden();
    return scope.studentId;
  }

  // ---- products (coin_shop.manage)

  async products() {
    const rows = await this.db.coinProduct.findMany({
      select: productSelect,
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    });
    return rows.map(productDto);
  }

  async createProduct(input: z.infer<typeof UpsertCoinProductSchema>) {
    return this.db.$transaction(async (tx) => {
      const p = await tx.coinProduct.create({
        data: { tenantId: requireTenantId(), ...input, description: input.description ?? null },
        select: productSelect,
      });
      await writeAudit(tx, {
        action: "coin_shop.product.create",
        entityType: "CoinProduct",
        entityId: p.id,
        after: input,
      });
      return productDto(p);
    });
  }

  async updateProduct(id: string, input: z.infer<typeof UpsertCoinProductSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.coinProduct.findFirst({ where: { id }, select: productSelect });
      if (!before) throw notFound();
      const p = await tx.coinProduct.update({
        where: { id },
        data: { ...input, description: input.description ?? null },
        select: productSelect,
      });
      await writeAudit(tx, {
        action: "coin_shop.product.update",
        entityType: "CoinProduct",
        entityId: id,
        before: productDto(before),
        after: input,
      });
      return productDto(p);
    });
  }

  /** Archived products leave the catalogue; their orders keep their snapshot. */
  async archiveProduct(id: string, archived: boolean) {
    return this.db.$transaction(async (tx) => {
      const p = await tx.coinProduct.findFirst({ where: { id }, select: { id: true } });
      if (!p) throw notFound();
      const row = await tx.coinProduct.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: productSelect,
      });
      await writeAudit(tx, {
        action: archived ? "coin_shop.product.archive" : "coin_shop.product.restore",
        entityType: "CoinProduct",
        entityId: id,
      });
      return productDto(row);
    });
  }

  async setImage(auth: RequestAuth, id: string, file: { buffer: Buffer; originalname: string }) {
    const type = imageType(file.buffer);
    if (!type) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "not_image" }] });
    if (file.buffer.length > MAX_IMAGE_BYTES)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "too_large" }] });
    if (!(await this.db.coinProduct.findFirst({ where: { id }, select: { id: true } }))) throw notFound();
    const tenantId = requireTenantId();
    const assetId = randomUUID();
    const key = storageKey(tenantId, "PRODUCT_IMAGE", assetId, type.ext);
    await this.storage.put(key, file.buffer, { contentType: type.mime });
    return this.db.$transaction(async (tx) => {
      await tx.fileAsset.create({
        data: {
          id: assetId,
          tenantId,
          storageKey: key,
          originalName: file.originalname.slice(0, 200),
          mimeType: type.mime,
          sizeBytes: file.buffer.length,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          kind: "PRODUCT_IMAGE",
          status: "READY",
          createdById: auth.userId,
        },
      });
      const p = await tx.coinProduct.update({ where: { id }, data: { imageAssetId: assetId }, select: productSelect });
      await writeAudit(tx, { action: "coin_shop.product.image", entityType: "CoinProduct", entityId: id });
      return productDto(p);
    });
  }

  /** Product pictures are not personal data: anyone in the shop's audience may load them. */
  async image(id: string) {
    const p = await this.db.coinProduct.findFirst({
      where: { id },
      select: { imageAsset: { select: { storageKey: true, mimeType: true, status: true } } },
    });
    if (!p?.imageAsset || p.imageAsset.status !== "READY") throw notFound();
    return { buffer: await this.storage.get(p.imageAsset.storageKey), mimeType: p.imageAsset.mimeType };
  }

  // ---- the student's side

  async catalog(auth: RequestAuth) {
    const studentId = await this.me(auth);
    const [settings, balance, rows] = await Promise.all([
      coinSettings(this.db),
      balanceOf(this.db, studentId),
      this.db.coinProduct.findMany({
        where: { isVisible: true, archivedAt: null },
        select: productSelect,
        orderBy: [{ price: "asc" }, { name: "asc" }],
      }),
    ]);
    const blockedReason =
      !settings.isEnabled || !settings.shopEnabled
        ? ("SHOP_CLOSED" as const)
        : !settings.newOrdersEnabled
          ? ("ORDERS_PAUSED" as const)
          : balance < 0
            ? ("IN_DEBT" as const)
            : null;
    return {
      balance,
      canOrder: blockedReason === null,
      blockedReason,
      items:
        blockedReason === "SHOP_CLOSED"
          ? []
          : rows.map((p) => {
              const { isVisible: _v, archived: _a, ...dto } = productDto(p);
              return { ...dto, affordable: p.stock > 0 && p.price <= balance };
            }),
    };
  }

  private async replayOrder(tx: Db | DbTransaction, key: string, studentId: string) {
    const found = await tx.coinOrder.findFirst({ where: { idempotencyKey: key }, select: orderSelect });
    if (!found) return null;
    if (found.studentId !== studentId) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
    return { order: orderDto(found), balance: await balanceOf(tx, studentId), duplicate: true };
  }

  async order(auth: RequestAuth, input: z.infer<typeof CreateCoinOrderSchema>) {
    const studentId = await this.me(auth);
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled || !settings.shopEnabled) throw coinsOff("SHOP_CLOSED");
    if (!settings.newOrdersEnabled) throw coinsOff("ORDERS_PAUSED");
    const replay = await this.replayOrder(this.db, input.idempotencyKey, studentId);
    if (replay) return replay;
    const { today } = await schoolClock(this.db);
    return this.db.$transaction(async (tx) => {
      await lockStudentCoins(tx, studentId);
      const again = await this.replayOrder(tx, input.idempotencyKey, studentId);
      if (again) return again;
      if ((await balanceOf(tx, studentId)) < 0) throw conflict("IN_DEBT");
      const product = await tx.coinProduct.findFirst({
        where: { id: input.productId, isVisible: true, archivedAt: null },
        select: productSelect,
      });
      if (!product) throw notFound();
      const taken = await tx.coinProduct.updateMany({
        where: { id: product.id, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });
      if (taken.count === 0) throw conflict("OUT_OF_STOCK");
      const approved = !settings.orderApprovalRequired;
      const order = await tx.coinOrder.create({
        data: {
          tenantId: requireTenantId(),
          studentId,
          productId: product.id,
          productNameSnapshot: product.name,
          priceAtOrder: product.price,
          status: approved ? "APPROVED" : "PENDING",
          approvedAt: approved ? new Date() : null,
          idempotencyKey: input.idempotencyKey,
        },
        select: orderSelect,
      });
      const { balance } = await post(tx, {
        studentId,
        type: "PURCHASE",
        source: "SHOP_PURCHASE",
        amount: -product.price,
        floor: 0,
        schoolDate: today,
        idempotencyKey: `order:${order.id}`,
        actorUserId: auth.userId,
        orderId: order.id,
      });
      await writeAudit(tx, {
        action: "coin_shop.order.create",
        entityType: "CoinOrder",
        entityId: order.id,
        after: { productId: product.id, price: product.price, status: order.status },
      });
      return { order: orderDto(order), balance, duplicate: false };
    });
  }

  async myOrders(auth: RequestAuth, q: z.infer<typeof CoinOrderQuerySchema>) {
    const studentId = await this.me(auth);
    return this.orders({ ...q, studentId });
  }

  async orders(q: z.infer<typeof CoinOrderQuerySchema>) {
    const base: Prisma.CoinOrderWhereInput = {
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.q
        ? {
            OR: [
              { productNameSnapshot: { contains: q.q, mode: "insensitive" } },
              { student: { firstName: { contains: q.q, mode: "insensitive" } } },
              { student: { lastName: { contains: q.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const where = q.status ? { ...base, status: q.status } : base;
    const [rows, total, counts] = await Promise.all([
      this.db.coinOrder.findMany({
        where,
        select: orderSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...skipTake(q),
      }),
      this.db.coinOrder.count({ where }),
      this.db.coinOrder.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    ]);
    return {
      ...page(rows.map(orderDto), total, q),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  /**
   * Moves an order on. The student may cancel only their own PENDING order; staff (coin_orders.process) approve,
   * reject, deliver or cancel. Rejecting / cancelling refunds the price and returns the item to stock.
   */
  async transition(auth: RequestAuth, id: string, to: CoinOrderStatus, note?: string) {
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled) throw coinsOff("COINS_DISABLED");
    const staff = auth.permissions.includes("coin_orders.process");
    const ownStudentId = staff ? null : await this.me(auth);
    const { today } = await schoolClock(this.db);
    return this.db.$transaction(async (tx) => {
      const first = await tx.coinOrder.findFirst({ where: { id }, select: { studentId: true } });
      if (!first || (ownStudentId && first.studentId !== ownStudentId)) throw notFound();
      await lockStudentCoins(tx, first.studentId);
      const order = await tx.coinOrder.findFirstOrThrow({ where: { id }, select: orderSelect });
      if (!staff && to !== "CANCELLED") throw forbidden();
      if (!canTransition(order.status, to)) throw conflict("ORDER_STATUS");
      if (!staff && order.status !== "PENDING") throw forbidden();
      const now = new Date();
      const updated = await tx.coinOrder.update({
        where: { id },
        data: {
          status: to,
          ...(note !== undefined ? { note } : {}),
          processedById: staff ? auth.userId : undefined,
          ...(to === "APPROVED" ? { approvedAt: now } : {}),
          ...(to === "DELIVERED" ? { deliveredAt: now, closedAt: now } : {}),
          ...(refundsOn(to) ? { closedAt: now } : {}),
        },
        select: orderSelect,
      });
      let balance = await balanceOf(tx, order.studentId);
      if (refundsOn(to)) {
        await tx.coinProduct.update({ where: { id: order.productId }, data: { stock: { increment: 1 } } });
        ({ balance } = await post(tx, {
          studentId: order.studentId,
          type: "REFUND",
          source: "REFUND",
          amount: order.priceAtOrder,
          floor: null,
          schoolDate: today,
          idempotencyKey: `refund:${order.id}`,
          actorUserId: auth.userId,
          orderId: order.id,
          reason: note ?? null,
        }));
      }
      await writeAudit(tx, {
        action: `coin_shop.order.${to.toLowerCase()}`,
        entityType: "CoinOrder",
        entityId: id,
        before: { status: order.status },
        after: { status: to },
        reason: note ?? null,
      });
      return { order: orderDto(updated), balance, duplicate: false };
    });
  }
}
