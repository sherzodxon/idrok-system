// Face photos and their sync to terminals (MASTER_SPEC §11 "Face ID oqimi", "Face Check"). The photo is normalised to
// what terminals accept (JPEG, ≤ 640 px, ≤ 200 KB, EXIF orientation applied, metadata dropped) and stored encrypted;
// the original upload is not kept. Each active terminal gets one FaceSyncJob row per student (its current state) and
// a device job; the terminal recognises the face itself, the server never compares faces.
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  FaceConsentDto,
  FaceDeviceStateDto,
  FaceProfileDto,
  FaceProfileQuerySchema,
  RecordFaceConsentSchema,
} from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb } from "@idrok/shared/time";
import type { z } from "zod";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import type { DataCipher } from "../../infra/crypto";
import { storageKey, type StorageProvider } from "../../infra/storage";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { attendanceSettings } from "./attendance-config.service";
import { imageType } from "../question-bank/question-bank.service";
import { enqueueDeviceJob, type JobDevice } from "./device-jobs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FACE_BYTES = 200 * 1024;
const MAX_SIDE = 640;
const MIN_SIDE = 160;

const invalid = (code: string) => new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code }] });

/** JPEG the terminals accept, or a validation error. */
export async function normalizeFacePhoto(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_UPLOAD_BYTES) throw invalid("too_large");
  if (!imageType(input)) throw invalid("not_image");
  let meta;
  try {
    meta = await sharp(input).rotate().metadata();
  } catch {
    throw invalid("not_image");
  }
  if (Math.min(meta.width ?? 0, meta.height ?? 0) < MIN_SIDE) throw invalid("too_small");
  for (const quality of [85, 75, 65, 55]) {
    const out = await sharp(input)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_FACE_BYTES) return out;
  }
  throw invalid("too_large");
}

const activeDevices = (tx: DbTransaction | Db) =>
  tx.device.findMany({
    where: { archivedAt: null, isActive: true },
    select: { id: true, useBridge: true, bridgeAgentId: true },
  });

type Student = { id: string; studentCode: string; firstName: string; lastName: string };

/** Puts one student's face (or its removal) on the given devices: sync row + device job each. */
async function syncStudent(
  tx: DbTransaction,
  student: Student,
  profile: { version: number; hasPhoto: boolean },
  devices: JobDevice[],
) {
  for (const device of devices) {
    const action = profile.hasPhoto ? "UPSERT" : "DELETE";
    const existing = await tx.faceSyncJob.findUnique({
      where: { deviceId_studentId: { deviceId: device.id, studentId: student.id } },
      select: { id: true },
    });
    if (!existing && action === "DELETE") continue;
    const data = {
      action,
      status: "PENDING",
      version: profile.hasPhoto ? profile.version : null,
      attempts: 0,
      lastError: null,
    } as const;
    const sync = existing
      ? await tx.faceSyncJob.update({ where: { id: existing.id }, data })
      : await tx.faceSyncJob.create({
          data: { tenantId: requireTenantId(), deviceId: device.id, studentId: student.id, ...data },
        });
    await enqueueDeviceJob(
      tx,
      device,
      profile.hasPhoto ? "FACE_UPSERT" : "FACE_DELETE",
      profile.hasPhoto
        ? {
            employeeNo: student.studentCode,
            name: `${student.lastName} ${student.firstName}`,
            version: profile.version,
          }
        : { employeeNo: student.studentCode },
      sync.id,
    );
  }
}

const studentSelect = { id: true, studentCode: true, firstName: true, lastName: true, status: true } as const;

/** Serialises photo uploads and consent changes of one student (a revoke cannot lose to an upload in flight). */
const lockFace = (tx: DbTransaction, studentId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`face:${requireTenantId()}:${studentId}`}, 0))`;

const activeConsent = (tx: DbTransaction | Db, studentId: string) =>
  tx.faceConsent.findFirst({ where: { studentId, revokedAt: null } });

const consentRequired = () => new AppError("CONFLICT", 409, { reason: "FACE_CONSENT_REQUIRED" });

const consentDto = (c: {
  id: string;
  guardianId: string | null;
  givenBy: string;
  givenOn: Date;
  note: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
}): FaceConsentDto => ({
  id: c.id,
  guardianId: c.guardianId,
  givenBy: c.givenBy,
  givenOn: schoolDateFromDb(c.givenOn),
  note: c.note,
  createdAt: c.createdAt.toISOString(),
  revokedAt: c.revokedAt?.toISOString() ?? null,
  revokeReason: c.revokeReason,
});

export class FaceService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageProvider,
    private readonly cipher: DataCipher,
  ) {}

  private async student(id: string) {
    const s = await this.db.student.findFirst({ where: { id }, select: studentSelect });
    if (!s) throw notFound();
    return s;
  }

  async setPhoto(auth: RequestAuth, studentId: string, file: { buffer: Buffer }): Promise<FaceProfileDto> {
    if (!this.cipher.configured) throw new AppError("CONFLICT", 409, { reason: "ENCRYPTION_NOT_CONFIGURED" });
    const student = await this.student(studentId);
    if (student.status !== "ACTIVE") throw new AppError("CONFLICT", 409, { reason: "STUDENT_NOT_ACTIVE" });
    const { faceConsentRequired } = await attendanceSettings(this.db);
    if (faceConsentRequired && !(await activeConsent(this.db, studentId))) throw consentRequired();
    const jpeg = await normalizeFacePhoto(file.buffer);
    const tenantId = requireTenantId();
    const assetId = randomUUID();
    const key = storageKey(tenantId, "FACE_PHOTO", assetId, "bin");
    await this.storage.put(key, this.cipher.encrypt(jpeg), { contentType: "application/octet-stream" });
    const oldKey = await this.db.$transaction(async (tx) => {
      // Checked again under the lock: the consent may have been revoked while the photo was processed.
      await lockFace(tx, studentId);
      if (faceConsentRequired && !(await activeConsent(tx, studentId))) throw consentRequired();
      await tx.fileAsset.create({
        data: {
          id: assetId,
          tenantId,
          storageKey: key,
          originalName: "face.jpg",
          mimeType: "image/jpeg",
          sizeBytes: jpeg.length,
          sha256: createHash("sha256").update(jpeg).digest("hex"),
          kind: "FACE_PHOTO",
          status: "READY",
          createdById: auth.userId,
        },
      });
      const before = await tx.faceProfile.findUnique({
        where: { tenantId_studentId: { tenantId, studentId } },
        select: { version: true, photoAsset: { select: { id: true, storageKey: true } } },
      });
      const profile = before
        ? await tx.faceProfile.update({
            where: { tenantId_studentId: { tenantId, studentId } },
            data: { photoAssetId: assetId, version: { increment: 1 } },
          })
        : await tx.faceProfile.create({ data: { tenantId, studentId, photoAssetId: assetId } });
      if (before?.photoAsset) {
        await tx.fileAsset.update({
          where: { id: before.photoAsset.id },
          data: { status: "DELETED", deletedAt: new Date() },
        });
      }
      await syncStudent(tx, student, { version: profile.version, hasPhoto: true }, await activeDevices(tx));
      await writeAudit(tx, {
        action: "face.photo.set",
        entityType: "FaceProfile",
        entityId: studentId,
        after: { version: profile.version },
      });
      return before?.photoAsset?.storageKey ?? null;
    });
    // Biometric data is not kept once replaced (best effort; the row is already marked DELETED).
    if (oldKey) await this.storage.delete(oldKey).catch(() => undefined);
    return this.profile(studentId);
  }

  // ---------------------------------------------------------------- consent (T-75)

  async consents(studentId: string): Promise<FaceConsentDto[]> {
    await this.student(studentId);
    const rows = await this.db.faceConsent.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } });
    return rows.map(consentDto);
  }

  async recordConsent(
    auth: RequestAuth,
    studentId: string,
    input: z.infer<typeof RecordFaceConsentSchema>,
  ): Promise<FaceConsentDto> {
    await this.student(studentId);
    const { today } = await schoolClock(this.db);
    if (input.givenOn > today)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "givenOn", code: "in_future" }] });
    let givenBy = input.givenBy;
    if (input.guardianId) {
      const link = await this.db.studentGuardian.findFirst({
        where: { studentId, guardianId: input.guardianId, revokedAt: null },
        select: { guardian: { select: { firstName: true, lastName: true } } },
      });
      if (!link) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "guardianId", code: "invalid" }] });
      givenBy ||= `${link.guardian.lastName} ${link.guardian.firstName}`;
    }
    return this.db.$transaction(async (tx) => {
      await lockFace(tx, studentId);
      if (await activeConsent(tx, studentId)) throw new AppError("CONFLICT", 409, { reason: "CONSENT_EXISTS" });
      const row = await tx.faceConsent.create({
        data: {
          tenantId: requireTenantId(),
          studentId,
          guardianId: input.guardianId,
          givenBy,
          givenOn: schoolDateToDb(input.givenOn),
          note: input.note ?? null,
          recordedById: auth.userId,
        },
      });
      await writeAudit(tx, {
        action: "face.consent.record",
        entityType: "FaceConsent",
        entityId: row.id,
        after: { studentId, guardianId: input.guardianId, givenOn: input.givenOn },
      });
      return consentDto(row);
    });
  }

  /** Revoking removes the face from the server and every device, in the same transaction as the revocation. */
  async revokeConsent(auth: RequestAuth, studentId: string, reason: string): Promise<FaceProfileDto> {
    const student = await this.student(studentId);
    const oldKey = await this.db.$transaction(async (tx) => {
      await lockFace(tx, studentId);
      const consent = await activeConsent(tx, studentId);
      if (!consent) throw notFound();
      await tx.faceConsent.update({
        where: { id: consent.id },
        data: { revokedAt: new Date(), revokedById: auth.userId, revokeReason: reason },
      });
      await writeAudit(tx, {
        action: "face.consent.revoke",
        entityType: "FaceConsent",
        entityId: consent.id,
        reason,
      });
      return this.clearFace(tx, student);
    });
    if (oldKey) await this.storage.delete(oldKey).catch(() => undefined);
    return this.profile(studentId);
  }

  async removePhoto(studentId: string): Promise<FaceProfileDto> {
    const student = await this.student(studentId);
    const oldKey = await this.db.$transaction(async (tx) => this.clearFace(tx, student));
    if (oldKey) await this.storage.delete(oldKey).catch(() => undefined);
    return this.profile(studentId);
  }

  /** Removes the photo and queues its removal from every device it was sent to. */
  private async clearFace(tx: DbTransaction, student: Student): Promise<string | null> {
    const tenantId = requireTenantId();
    const before = await tx.faceProfile.findUnique({
      where: { tenantId_studentId: { tenantId, studentId: student.id } },
      select: { id: true, version: true, photoAsset: { select: { id: true, storageKey: true } } },
    });
    if (!before?.photoAsset) return null;
    const profile = await tx.faceProfile.update({
      where: { id: before.id },
      data: { photoAssetId: null, version: { increment: 1 } },
    });
    await tx.fileAsset.update({
      where: { id: before.photoAsset.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const devices = await tx.device.findMany({
      where: { archivedAt: null, faceSyncs: { some: { studentId: student.id } } },
      select: { id: true, useBridge: true, bridgeAgentId: true },
    });
    await syncStudent(tx, student, { version: profile.version, hasPhoto: false }, devices);
    await writeAudit(tx, { action: "face.photo.remove", entityType: "FaceProfile", entityId: student.id });
    return before.photoAsset.storageKey;
  }

  /** Sends the current state again (after a failure), to every active device or one. */
  async resync(studentId: string, deviceId?: string): Promise<FaceProfileDto> {
    const student = await this.student(studentId);
    await this.db.$transaction(async (tx) => {
      const profile = await tx.faceProfile.findUnique({
        where: { tenantId_studentId: { tenantId: requireTenantId(), studentId } },
        select: { version: true, photoAssetId: true },
      });
      const hasPhoto = !!profile?.photoAssetId && student.status === "ACTIVE";
      const devices = (await activeDevices(tx)).filter((d) => !deviceId || d.id === deviceId);
      if (deviceId && !devices.length) throw notFound();
      await syncStudent(tx, student, { version: profile?.version ?? 1, hasPhoto }, devices);
      await writeAudit(tx, {
        action: "face.resync",
        entityType: "FaceProfile",
        entityId: studentId,
        after: { deviceId },
      });
    });
    return this.profile(studentId);
  }

  /** Asks the devices whether they hold the student's face ("Qurilmadan tekshirish"). */
  async check(studentId: string): Promise<FaceProfileDto> {
    const student = await this.student(studentId);
    await this.db.$transaction(async (tx) => {
      const syncs = await tx.faceSyncJob.findMany({
        where: { studentId, device: { archivedAt: null, isActive: true } },
        select: { id: true, device: { select: { id: true, useBridge: true, bridgeAgentId: true } } },
      });
      for (const s of syncs) {
        await enqueueDeviceJob(tx, s.device, "FACE_CHECK", { employeeNo: student.studentCode }, s.id);
      }
    });
    return this.profile(studentId);
  }

  /** Every active student with a photo, to one device (a new or reset terminal). */
  async syncDevice(deviceId: string): Promise<{ queued: number }> {
    return this.db.$transaction(async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, archivedAt: null, isActive: true },
        select: { id: true, useBridge: true, bridgeAgentId: true },
      });
      if (!device) throw notFound();
      const profiles = await tx.faceProfile.findMany({
        where: { photoAssetId: { not: null }, student: { status: "ACTIVE" } },
        select: { version: true, student: { select: studentSelect } },
      });
      for (const p of profiles) await syncStudent(tx, p.student, { version: p.version, hasPhoto: true }, [device]);
      await writeAudit(tx, {
        action: "face.sync_device",
        entityType: "Device",
        entityId: deviceId,
        after: { count: profiles.length },
      });
      return { queued: profiles.length };
    });
  }

  /**
   * Students who left (not ACTIVE) lose their face on every device and on the server (maintenance; idempotent).
   * Returns how many were cleared.
   */
  async removeInactive(): Promise<number> {
    const left = await this.db.faceProfile.findMany({
      where: { photoAssetId: { not: null }, student: { status: { not: "ACTIVE" } } },
      select: { student: { select: studentSelect } },
    });
    for (const p of left) {
      const key = await this.db.$transaction((tx) => this.clearFace(tx, p.student));
      if (key) await this.storage.delete(key).catch(() => undefined);
    }
    return left.length;
  }

  async photo(studentId: string): Promise<Buffer> {
    const p = await this.db.faceProfile.findUnique({
      where: { tenantId_studentId: { tenantId: requireTenantId(), studentId } },
      select: { photoAsset: { select: { storageKey: true, status: true } } },
    });
    if (!p?.photoAsset || p.photoAsset.status !== "READY") throw notFound();
    return this.cipher.decrypt(await this.storage.get(p.photoAsset.storageKey));
  }

  // ---------------------------------------------------------------- Face Check

  private async rows(where: Prisma.StudentWhereInput) {
    const devices = await this.db.device.findMany({
      where: { archivedAt: null, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const students = await this.db.student.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
        enrollments: { where: { status: "ACTIVE" }, select: { classGroup: { select: { name: true } } }, take: 1 },
        faceProfile: { select: { version: true, photoAssetId: true, updatedAt: true } },
        faceConsents: { where: { revokedAt: null }, select: { givenBy: true, givenOn: true }, take: 1 },
        faceSyncJobs: {
          where: { deviceId: { in: devices.map((d) => d.id) } },
          select: {
            deviceId: true,
            action: true,
            status: true,
            version: true,
            syncedVersion: true,
            attempts: true,
            lastError: true,
            syncedAt: true,
            lastCheckedAt: true,
            deviceHasFace: true,
          },
        },
      },
    });
    const deviceName = new Map(devices.map((d) => [d.id, d.name]));
    return students.map((s): FaceProfileDto => {
      const p = s.faceProfile[0];
      const hasPhoto = !!p?.photoAssetId;
      const states: FaceDeviceStateDto[] = s.faceSyncJobs.map((j) => ({
        deviceId: j.deviceId,
        deviceName: deviceName.get(j.deviceId) ?? "",
        action: j.action,
        status: j.status,
        upToDate: j.status === "SYNCED" && (j.action === "DELETE" || j.syncedVersion === p?.version),
        attempts: j.attempts,
        lastError: j.lastError,
        syncedAt: j.syncedAt?.toISOString() ?? null,
        lastCheckedAt: j.lastCheckedAt?.toISOString() ?? null,
        deviceHasFace: j.deviceHasFace,
      }));
      const upserts = states.filter((x) => x.action === "UPSERT");
      const overall = !hasPhoto
        ? "NONE"
        : upserts.some((x) => x.status === "FAILED")
          ? "FAILED"
          : upserts.length < devices.length || upserts.some((x) => !x.upToDate)
            ? "PENDING"
            : "SYNCED";
      return {
        studentId: s.id,
        studentCode: s.studentCode,
        firstName: s.firstName,
        lastName: s.lastName,
        className: s.enrollments[0]?.classGroup.name ?? null,
        hasPhoto,
        version: p?.version ?? null,
        updatedAt: hasPhoto ? (p?.updatedAt.toISOString() ?? null) : null,
        overall,
        devices: states,
        consent: s.faceConsents[0]
          ? { givenBy: s.faceConsents[0].givenBy, givenOn: schoolDateFromDb(s.faceConsents[0].givenOn) }
          : null,
      };
    });
  }

  async profile(studentId: string): Promise<FaceProfileDto> {
    const [row] = await this.rows({ id: studentId });
    if (!row) throw notFound();
    return row;
  }

  async list(q: z.infer<typeof FaceProfileQuerySchema>) {
    const where: Prisma.StudentWhereInput = {
      status: "ACTIVE",
      ...(q.classGroupId ? { enrollments: { some: { classGroupId: q.classGroupId, status: "ACTIVE" } } } : {}),
      ...(q.q
        ? {
            OR: [
              { lastName: { contains: q.q, mode: "insensitive" as const } },
              { firstName: { contains: q.q, mode: "insensitive" as const } },
              { studentCode: { contains: q.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const all = await this.rows(where);
    const counts = Object.fromEntries(
      (["NONE", "SYNCED", "PENDING", "FAILED"] as const).map((k) => [k, all.filter((r) => r.overall === k).length]),
    );
    const filtered = q.overall ? all.filter((r) => r.overall === q.overall) : all;
    const start = (q.page - 1) * q.pageSize;
    return {
      items: filtered.slice(start, start + q.pageSize),
      total: filtered.length,
      page: q.page,
      pageSize: q.pageSize,
      counts,
    };
  }
}
