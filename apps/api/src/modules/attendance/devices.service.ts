// Face ID terminals and bridge agents (MASTER_SPEC §11 "Qurilmalar", "Bridge"). Credentials are shown once:
// a device's webhook key and a bridge token are stored only as SHA-256 hashes; the device password is encrypted and
// never returned. Every change is audited in the same transaction (secrets never enter the audit log).
import type { z } from "zod";
import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type { BridgeAgentDto, DeviceDto, UpsertBridgeAgentSchema, UpsertDeviceSchema } from "@idrok/shared";
import { schoolDateToDb } from "@idrok/shared/time";
import { connectionStatus } from "../../domain/attendance";
import { AppError, notFound } from "../../http/errors";
import { newSecret, sha256Hex, type DataCipher } from "../../infra/crypto";
import { writeAudit } from "../audit/audit.service";
import { schoolClock } from "../access/school-clock";
import { attendanceSettings } from "./attendance-config.service";

/** How long a rotated bridge token keeps working (the bridge may have a request in flight). */
export const BRIDGE_TOKEN_OVERLAP_MS = 10 * 60_000;

const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });
const invalid = (path: string, code = "invalid") => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const deviceSelect = {
  id: true,
  name: true,
  serialNumber: true,
  ipAddress: true,
  port: true,
  username: true,
  passwordEnc: true,
  direction: true,
  location: true,
  useBridge: true,
  bridgeAgentId: true,
  bridgeAgent: { select: { name: true } },
  isActive: true,
  model: true,
  firmware: true,
  lastSeenAt: true,
  lastEventAt: true,
  lastError: true,
  archivedAt: true,
} satisfies Prisma.DeviceSelect;
type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>;

/** Audit view of a device: no secrets. */
const deviceAudit = (d: Partial<DeviceRow> & Record<string, unknown>) => {
  const { passwordEnc, bridgeAgent: _b, ...rest } = d;
  return { ...rest, hasPassword: !!passwordEnc };
};

const bridgeSelect = {
  id: true,
  name: true,
  isActive: true,
  version: true,
  hostname: true,
  queueDepth: true,
  lastSeenAt: true,
  tokenRotatedAt: true,
  _count: {
    select: { devices: { where: { archivedAt: null } }, jobs: { where: { status: { in: ["QUEUED", "LEASED"] } } } },
  },
} satisfies Prisma.BridgeAgentSelect;
type BridgeRow = Prisma.BridgeAgentGetPayload<{ select: typeof bridgeSelect }>;

export class DevicesService {
  constructor(
    private readonly db: Db,
    private readonly cipher: DataCipher,
    private readonly publicApiUrl: string | undefined,
  ) {}

  webhookPath(key: string) {
    return `${this.publicApiUrl ?? ""}/attendance/hikvision-event/${key}`;
  }

  // ---------------------------------------------------------------- devices

  async listDevices(): Promise<DeviceDto[]> {
    const [rows, settings, { today }] = await Promise.all([
      this.db.device.findMany({ orderBy: [{ archivedAt: "desc" }, { name: "asc" }], select: deviceSelect }),
      attendanceSettings(this.db),
      schoolClock(this.db),
    ]);
    const ids = rows.map((r) => r.id);
    const [events, faces] = await Promise.all([
      this.db.accessEvent.groupBy({
        by: ["deviceId"],
        where: { deviceId: { in: ids }, schoolDate: schoolDateToDb(today) },
        _count: { _all: true },
      }),
      this.db.faceSyncJob.groupBy({
        by: ["deviceId", "status"],
        where: { deviceId: { in: ids }, action: "UPSERT" },
        _count: { _all: true },
      }),
    ]);
    const eventsOf = new Map(events.map((e) => [e.deviceId, e._count._all]));
    const now = new Date();
    return rows.map((d) => {
      const f = faces.filter((x) => x.deviceId === d.id);
      const n = (s: string[]) => f.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
      return this.deviceDto(d, now, settings.deviceStaleSeconds, eventsOf.get(d.id) ?? 0, {
        synced: n(["SYNCED"]),
        pending: n(["PENDING", "IN_PROGRESS"]),
        failed: n(["FAILED"]),
      });
    });
  }

  private deviceDto(
    d: DeviceRow,
    now: Date,
    staleSeconds: number,
    eventsToday = 0,
    faces = { synced: 0, pending: 0, failed: 0 },
  ): DeviceDto {
    return {
      id: d.id,
      name: d.name,
      serialNumber: d.serialNumber,
      ipAddress: d.ipAddress,
      port: d.port,
      username: d.username,
      hasPassword: !!d.passwordEnc,
      direction: d.direction,
      location: d.location,
      useBridge: d.useBridge,
      bridgeAgentId: d.bridgeAgentId,
      bridgeAgentName: d.bridgeAgent?.name ?? null,
      isActive: d.isActive,
      model: d.model,
      firmware: d.firmware,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastEventAt: d.lastEventAt?.toISOString() ?? null,
      lastError: d.lastError,
      connection: connectionStatus(d.lastSeenAt, now, staleSeconds),
      archived: d.archivedAt !== null,
      eventsToday,
      faces,
    };
  }

  private async one(id: string): Promise<DeviceDto> {
    const d = await this.db.device.findUnique({ where: { id }, select: deviceSelect });
    if (!d) throw notFound();
    const settings = await attendanceSettings(this.db);
    return this.deviceDto(d, new Date(), settings.deviceStaleSeconds);
  }

  private async deviceData(input: z.infer<typeof UpsertDeviceSchema>) {
    if (input.bridgeAgentId) {
      const agent = await this.db.bridgeAgent.findUnique({ where: { id: input.bridgeAgentId }, select: { id: true } });
      if (!agent) throw invalid("bridgeAgentId", "not_found");
    }
    const { password, ...rest } = input;
    const data: Prisma.DeviceUncheckedUpdateInput = {
      ...rest,
      bridgeAgentId: input.useBridge ? input.bridgeAgentId : null,
    };
    if (password === null) data.passwordEnc = null;
    else if (password !== undefined) data.passwordEnc = this.cipher.encryptString(password);
    return data;
  }

  private uniqueGuard(err: unknown): never {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002")
      throw conflict("DUPLICATE");
    throw err;
  }

  async createDevice(input: z.infer<typeof UpsertDeviceSchema>) {
    const data = await this.deviceData(input);
    const key = newSecret();
    const id = await this.db
      .$transaction(async (tx) => {
        const row = await tx.device.create({
          data: {
            ...(data as Prisma.DeviceUncheckedCreateInput),
            tenantId: requireTenantId(),
            webhookKeyHash: sha256Hex(key),
          },
          select: deviceSelect,
        });
        await writeAudit(tx, {
          action: "device.create",
          entityType: "Device",
          entityId: row.id,
          after: deviceAudit(row),
        });
        return row.id;
      })
      .catch((e: unknown) => this.uniqueGuard(e));
    return { device: await this.one(id), webhookKey: key, webhookPath: this.webhookPath(key) };
  }

  async updateDevice(id: string, input: z.infer<typeof UpsertDeviceSchema>): Promise<DeviceDto> {
    const data = await this.deviceData(input);
    await this.db
      .$transaction(async (tx) => {
        const before = await tx.device.findUnique({ where: { id }, select: deviceSelect });
        if (!before) throw notFound();
        if (before.archivedAt) throw conflict("ARCHIVED");
        const after = await tx.device.update({ where: { id }, data, select: deviceSelect });
        await writeAudit(tx, {
          action: "device.update",
          entityType: "Device",
          entityId: id,
          before: deviceAudit(before),
          after: deviceAudit(after),
        });
      })
      .catch((e: unknown) => this.uniqueGuard(e));
    return this.one(id);
  }

  /** New webhook key; the old one stops working at once (the terminal's HTTP listening URL must be changed). */
  async rotateDeviceKey(id: string) {
    const key = newSecret();
    await this.db.$transaction(async (tx) => {
      const d = await tx.device.findUnique({ where: { id }, select: { archivedAt: true } });
      if (!d) throw notFound();
      if (d.archivedAt) throw conflict("ARCHIVED");
      await tx.device.update({ where: { id }, data: { webhookKeyHash: sha256Hex(key) } });
      await writeAudit(tx, { action: "device.rotate_key", entityType: "Device", entityId: id });
    });
    return { device: await this.one(id), webhookKey: key, webhookPath: this.webhookPath(key) };
  }

  /** Archive: the device stops accepting events; its events and history stay. */
  async archiveDevice(id: string): Promise<DeviceDto> {
    await this.db.$transaction(async (tx) => {
      const d = await tx.device.findUnique({ where: { id }, select: { archivedAt: true } });
      if (!d) throw notFound();
      if (d.archivedAt) return;
      await tx.device.update({
        where: { id },
        data: { archivedAt: new Date(), isActive: false, webhookKeyHash: sha256Hex(newSecret()) },
      });
      await tx.bridgeJob.updateMany({
        where: { deviceId: id, status: { in: ["QUEUED", "LEASED"] } },
        data: { status: "FAILED", error: "device archived", completedAt: new Date() },
      });
      await writeAudit(tx, { action: "device.archive", entityType: "Device", entityId: id });
    });
    return this.one(id);
  }

  // ---------------------------------------------------------------- bridge agents

  async listBridges(): Promise<BridgeAgentDto[]> {
    const [rows, settings] = await Promise.all([
      this.db.bridgeAgent.findMany({ orderBy: { name: "asc" }, select: bridgeSelect }),
      attendanceSettings(this.db),
    ]);
    const now = new Date();
    return rows.map((b) => this.bridgeDto(b, now, settings.deviceStaleSeconds));
  }

  private bridgeDto(b: BridgeRow, now: Date, staleSeconds: number): BridgeAgentDto {
    return {
      id: b.id,
      name: b.name,
      isActive: b.isActive,
      version: b.version,
      hostname: b.hostname,
      queueDepth: b.queueDepth,
      lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
      tokenRotatedAt: b.tokenRotatedAt.toISOString(),
      connection: connectionStatus(b.lastSeenAt, now, staleSeconds),
      deviceCount: b._count.devices,
      pendingJobs: b._count.jobs,
    };
  }

  private async bridge(id: string): Promise<BridgeAgentDto> {
    const b = await this.db.bridgeAgent.findUnique({ where: { id }, select: bridgeSelect });
    if (!b) throw notFound();
    return this.bridgeDto(b, new Date(), (await attendanceSettings(this.db)).deviceStaleSeconds);
  }

  async createBridge(input: z.infer<typeof UpsertBridgeAgentSchema>) {
    const token = newSecret();
    const id = await this.db
      .$transaction(async (tx) => {
        const row = await tx.bridgeAgent.create({
          data: {
            tenantId: requireTenantId(),
            name: input.name,
            isActive: input.isActive ?? true,
            tokenHash: sha256Hex(token),
          },
        });
        await writeAudit(tx, { action: "bridge.create", entityType: "BridgeAgent", entityId: row.id, after: input });
        return row.id;
      })
      .catch((e: unknown) => this.uniqueGuard(e));
    return { agent: await this.bridge(id), token };
  }

  async updateBridge(id: string, input: z.infer<typeof UpsertBridgeAgentSchema>): Promise<BridgeAgentDto> {
    await this.db
      .$transaction(async (tx) => {
        const before = await tx.bridgeAgent.findUnique({ where: { id }, select: { name: true, isActive: true } });
        if (!before) throw notFound();
        await tx.bridgeAgent.update({ where: { id }, data: input });
        await writeAudit(tx, {
          action: "bridge.update",
          entityType: "BridgeAgent",
          entityId: id,
          before,
          after: input,
        });
      })
      .catch((e: unknown) => this.uniqueGuard(e));
    return this.bridge(id);
  }

  /** Admin rotation: the old token stops working at once (a lost or leaked token). */
  async rotateBridgeToken(id: string) {
    const token = newSecret();
    await this.db.$transaction(async (tx) => {
      const b = await tx.bridgeAgent.findUnique({ where: { id }, select: { id: true } });
      if (!b) throw notFound();
      await tx.bridgeAgent.update({
        where: { id },
        data: {
          tokenHash: sha256Hex(token),
          previousTokenHash: null,
          previousTokenExpiresAt: null,
          tokenRotatedAt: new Date(),
        },
      });
      await writeAudit(tx, { action: "bridge.rotate_token", entityType: "BridgeAgent", entityId: id });
    });
    return { agent: await this.bridge(id), token };
  }
}
