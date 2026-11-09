// School attendance settings and lateness bands (MASTER_SPEC §11 "Kechikish"). A band in use is archived, never
// deleted; active bands never overlap. Every change is audited in the same transaction.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type {
  AttendanceSettingsDto,
  LatenessBandDto,
  UpdateAttendanceSettingsSchema,
  UpsertLatenessBandSchema,
} from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb } from "@idrok/shared/time";
import { bandsOverlap, type LatenessBand } from "../../domain/attendance";
import { AppError, notFound } from "../../http/errors";
import type { DataCipher } from "../../infra/crypto";
import { writeAudit } from "../audit/audit.service";

type Settings = Omit<AttendanceSettingsDto, "encryptionConfigured">;

export const ATTENDANCE_SETTINGS_DEFAULTS: Settings = {
  isEnabled: false,
  defaultStartMinute: 8 * 60 + 30,
  defaultEndMinute: 13 * 60 + 30,
  graceMinutes: 0,
  acceptedSubEvents: [75],
  maxClockSkewSeconds: 300,
  maxEventAgeDays: 7,
  deviceStaleSeconds: 180,
  faceConsentRequired: true,
  faceConsentGraceEndsOn: null,
  staffStartMinute: 8 * 60,
  staffEndMinute: 17 * 60,
  staffGraceMinutes: 0,
};

export async function attendanceSettings(db: Db | DbTransaction): Promise<Settings> {
  const row = await db.attendanceSettings.findFirst();
  if (!row) return ATTENDANCE_SETTINGS_DEFAULTS;
  const { tenantId: _t, updatedAt: _u, faceConsentGraceEndsOn, ...rest } = row;
  return { ...rest, faceConsentGraceEndsOn: faceConsentGraceEndsOn ? schoolDateFromDb(faceConsentGraceEndsOn) : null };
}

/** Active bands of the school, for the attendance calculation. */
export async function activeBands(db: Db | DbTransaction): Promise<LatenessBand[]> {
  return db.latenessBand.findMany({
    where: { archivedAt: null },
    orderBy: { fromMinute: "asc" },
    select: { id: true, fromMinute: true, toMinute: true },
  });
}

const invalid = (path: string, code = "invalid") => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const bandDto = (b: {
  id: string;
  name: string;
  fromMinute: number;
  toMinute: number | null;
  archivedAt: Date | null;
}): LatenessBandDto => ({
  id: b.id,
  name: b.name,
  fromMinute: b.fromMinute,
  toMinute: b.toMinute,
  archived: b.archivedAt !== null,
});

export class AttendanceConfigService {
  constructor(
    private readonly db: Db,
    private readonly cipher: DataCipher,
  ) {}

  async getSettings(): Promise<AttendanceSettingsDto> {
    return { ...(await attendanceSettings(this.db)), encryptionConfigured: this.cipher.configured };
  }

  async updateSettings(input: z.infer<typeof UpdateAttendanceSettingsSchema>): Promise<AttendanceSettingsDto> {
    return this.db.$transaction(async (tx) => {
      const before = await attendanceSettings(tx);
      const next = { ...before, ...input };
      if (next.defaultEndMinute <= next.defaultStartMinute) throw invalid("defaultEndMinute", "before_start");
      if (next.staffEndMinute <= next.staffStartMinute) throw invalid("staffEndMinute", "before_start");
      next.acceptedSubEvents = [...new Set(next.acceptedSubEvents)].sort((a, b) => a - b);
      const row = {
        ...next,
        faceConsentGraceEndsOn: next.faceConsentGraceEndsOn ? schoolDateToDb(next.faceConsentGraceEndsOn) : null,
      };
      await tx.attendanceSettings.upsert({
        where: { tenantId: requireTenantId() },
        create: { tenantId: requireTenantId(), ...row },
        update: row,
      });
      await writeAudit(tx, {
        action: "attendance.settings.update",
        entityType: "AttendanceSettings",
        before,
        after: next,
      });
      return { ...next, encryptionConfigured: this.cipher.configured };
    });
  }

  async listBands(): Promise<LatenessBandDto[]> {
    const rows = await this.db.latenessBand.findMany({ orderBy: [{ archivedAt: "desc" }, { fromMinute: "asc" }] });
    return rows.map(bandDto);
  }

  private async assertNoOverlap(tx: DbTransaction, band: z.infer<typeof UpsertLatenessBandSchema>, exceptId?: string) {
    const others = await tx.latenessBand.findMany({
      where: { archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { fromMinute: true, toMinute: true },
    });
    if (bandsOverlap([...others, band])) throw invalid("fromMinute", "overlap");
  }

  private lockBands(tx: DbTransaction) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lateness-bands:${requireTenantId()}`}, 0))`;
  }

  async createBand(input: z.infer<typeof UpsertLatenessBandSchema>): Promise<LatenessBandDto> {
    return this.db.$transaction(async (tx) => {
      await this.lockBands(tx);
      await this.assertNoOverlap(tx, input);
      const row = await tx.latenessBand.create({ data: { tenantId: requireTenantId(), ...input } });
      await writeAudit(tx, {
        action: "attendance.band.create",
        entityType: "LatenessBand",
        entityId: row.id,
        after: input,
      });
      return bandDto(row);
    });
  }

  async updateBand(id: string, input: z.infer<typeof UpsertLatenessBandSchema>): Promise<LatenessBandDto> {
    return this.db.$transaction(async (tx) => {
      await this.lockBands(tx);
      const before = await tx.latenessBand.findUnique({ where: { id } });
      if (!before) throw notFound();
      if (before.archivedAt) throw new AppError("CONFLICT", 409, { reason: "ARCHIVED" });
      await this.assertNoOverlap(tx, input, id);
      // A used band keeps its range (past records were counted with it): only the name changes.
      const used = (await tx.attendanceRecord.count({ where: { latenessBandId: id } })) > 0;
      if (used && (before.fromMinute !== input.fromMinute || before.toMinute !== input.toMinute)) {
        throw new AppError("CONFLICT", 409, { reason: "BAND_IN_USE" });
      }
      const row = await tx.latenessBand.update({ where: { id }, data: input });
      await writeAudit(tx, {
        action: "attendance.band.update",
        entityType: "LatenessBand",
        entityId: id,
        before: bandDto(before),
        after: input,
      });
      return bandDto(row);
    });
  }

  /** Deletes an unused band; archives a used one. */
  async deleteBand(id: string): Promise<{ deleted: boolean }> {
    return this.db.$transaction(async (tx) => {
      const before = await tx.latenessBand.findUnique({ where: { id } });
      if (!before) throw notFound();
      const used =
        (await tx.attendanceRecord.count({ where: { latenessBandId: id } })) > 0 ||
        (await tx.coinAutoRule.count({
          where: { source: "ATTENDANCE", config: { path: ["latenessBandId"], equals: id } },
        })) > 0;
      if (used) {
        await tx.latenessBand.update({ where: { id }, data: { archivedAt: new Date() } });
      } else {
        await tx.latenessBand.delete({ where: { id } });
      }
      await writeAudit(tx, {
        action: used ? "attendance.band.archive" : "attendance.band.delete",
        entityType: "LatenessBand",
        entityId: id,
        before: bandDto(before),
      });
      return { deleted: !used };
    });
  }
}
