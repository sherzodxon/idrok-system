import { createHash, randomUUID } from "node:crypto";
import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type { ImportJobDto, ImportKindCode, ListQuery } from "@idrok/shared";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import type { StorageProvider } from "../../infra/storage";
import { storageKey } from "../../infra/storage";
import { writeAudit } from "../audit/audit.service";
import { XLSX } from "./imports.processor";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** .xlsx files are ZIP archives: "PK\x03\x04". */
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

type JobRow = Prisma.ImportJobGetPayload<{
  include: { fileAsset: { select: { originalName: true } }; resultAsset: { select: { status: true } } };
}>;

const toDto = (j: JobRow): ImportJobDto => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  fileName: j.fileAsset.originalName,
  summary: (j.summary as Record<string, number> | null) ?? null,
  errorCount: j.errorCount,
  warningCount: j.warningCount,
  failure: (j.failure as { code: string } | null) ?? null,
  hasCredentials: j.resultAsset?.status === "READY",
  createdAt: j.createdAt.toISOString(),
  committedAt: j.committedAt?.toISOString() ?? null,
});

const include = { fileAsset: { select: { originalName: true } }, resultAsset: { select: { status: true } } } as const;

/**
 * Without imports.run a caller (a teacher with curriculum.create) sees only their own curriculum plan imports;
 * any other job does not exist for them.
 */
function assertJobAccess(auth: RequestAuth | undefined, job: { kind: string; createdById: string }) {
  if (!auth || auth.permissions.includes("imports.run")) return;
  if (job.kind !== "CURRICULUM_PLAN" || job.createdById !== auth.userId) throw notFound();
}

export class ImportsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageProvider,
  ) {}

  async upload(
    auth: RequestAuth,
    input: { kind: ImportKindCode; options: Record<string, unknown>; file: { buffer: Buffer; originalname: string } },
  ) {
    const { buffer, originalname } = input.file;
    if (buffer.length > MAX_IMPORT_BYTES)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "too_large" }] });
    if (!isZip(buffer) || !/\.xlsx$/i.test(originalname)) {
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "not_xlsx" }] });
    }
    const tenantId = requireTenantId();
    const fileId = randomUUID();
    const key = storageKey(tenantId, "IMPORT_SOURCE", fileId, "xlsx");
    await this.storage.put(key, buffer, { contentType: XLSX });
    const job = await this.db.$transaction(async (tx) => {
      await tx.fileAsset.create({
        data: {
          id: fileId,
          tenantId,
          storageKey: key,
          originalName: originalname.slice(0, 200),
          mimeType: XLSX,
          sizeBytes: buffer.length,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          kind: "IMPORT_SOURCE",
          status: "READY",
          createdById: auth.userId,
        },
      });
      const j = await tx.importJob.create({
        data: {
          tenantId,
          kind: input.kind,
          fileAssetId: fileId,
          options: input.options as Prisma.InputJsonValue,
          createdById: auth.userId,
        },
        include,
      });
      // Parsing runs in the worker; the outbox guarantees the job is queued exactly when this transaction commits.
      await tx.outboxEvent.create({
        data: {
          tenantId,
          type: "import.parse_requested",
          aggregateType: "ImportJob",
          aggregateId: j.id,
          payload: { tenantId, importJobId: j.id, actorUserId: auth.userId },
        },
      });
      await writeAudit(tx, {
        action: "import.upload",
        entityType: "ImportJob",
        entityId: j.id,
        after: { kind: input.kind },
      });
      return j;
    });
    return toDto(job);
  }

  async list(q: ListQuery) {
    const [items, total] = await Promise.all([
      this.db.importJob.findMany({ orderBy: { createdAt: "desc" }, include, ...skipTake(q) }),
      this.db.importJob.count(),
    ]);
    return page(items.map(toDto), total, q);
  }

  async get(id: string, auth?: RequestAuth) {
    const j = await this.db.importJob.findUnique({ where: { id }, include });
    if (!j) throw notFound();
    assertJobAccess(auth, j);
    return toDto(j);
  }

  async rows(id: string, q: ListQuery & { status?: "OK" | "WARNING" | "ERROR" | "SKIPPED" }, auth?: RequestAuth) {
    await this.get(id, auth); // tenant and owner check: ImportRow has no tenantId of its own
    const where = { importJobId: id, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      this.db.importRow.findMany({ where, orderBy: { rowNumber: "asc" }, ...skipTake(q) }),
      this.db.importRow.count({ where }),
    ]);
    return page(
      items.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        data: r.data as Record<string, unknown>,
        messages: r.messages as { code: string; field?: string; params?: Record<string, unknown> }[],
      })),
      total,
      q,
    );
  }

  /** PREVIEW_READY → COMMITTING exactly once (a second click is a 409); rows with errors need skipErrors. */
  async commit(auth: RequestAuth, id: string, skipErrors: boolean) {
    const tenantId = requireTenantId();
    await this.db.$transaction(async (tx) => {
      const job = await tx.importJob.findUnique({ where: { id } });
      if (!job) throw notFound();
      assertJobAccess(auth, job);
      // A plan is one document: rows with errors are fixed in the file, never skipped (acceptance 9).
      if (job.kind === "CURRICULUM_PLAN") skipErrors = false;
      const moved = await tx.importJob.updateMany({
        where: { id, status: "PREVIEW_READY", ...(skipErrors ? {} : { errorCount: 0 }) },
        data: { status: "COMMITTING", options: { ...((job.options as object | null) ?? {}), skipErrors } },
      });
      if (!moved.count) {
        throw new AppError("CONFLICT", 409, {
          reason: job.status !== "PREVIEW_READY" ? "IMPORT_NOT_READY" : "IMPORT_HAS_ERRORS",
        });
      }
      await tx.outboxEvent.create({
        data: {
          tenantId,
          type: "import.commit_requested",
          aggregateType: "ImportJob",
          aggregateId: id,
          payload: { tenantId, importJobId: id, actorUserId: auth.userId },
        },
      });
      await writeAudit(tx, {
        action: "import.commit_requested",
        entityType: "ImportJob",
        entityId: id,
        after: { skipErrors },
      });
    });
    return this.get(id);
  }

  async cancel(id: string, auth?: RequestAuth) {
    await this.get(id, auth);
    const moved = await this.db.importJob.updateMany({
      where: { id, status: { in: ["UPLOADED", "PREVIEW_READY", "FAILED"] } },
      data: { status: "CANCELLED" },
    });
    if (!moved.count) {
      await this.get(id);
      throw new AppError("CONFLICT", 409, { reason: "IMPORT_NOT_CANCELLABLE" });
    }
    return this.get(id);
  }

  /**
   * The credentials file of a commit: only for the user who ran the import, only once. The file is marked deleted
   * before it is sent and removed from storage afterwards (security-baseline.md S3).
   */
  async takeCredentials(auth: RequestAuth, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const asset = await this.db.$transaction(async (tx) => {
      const job = await tx.importJob.findUnique({ where: { id }, include: { resultAsset: true } });
      if (!job) throw notFound();
      if (job.createdById !== auth.userId) throw new AppError("FORBIDDEN", 403, { reason: "NOT_IMPORT_OWNER" });
      const taken = await tx.fileAsset.updateMany({
        where: { id: job.resultAssetId ?? "00000000-0000-0000-0000-000000000000", status: "READY" },
        data: { status: "DELETED", deletedAt: new Date() },
      });
      if (!taken.count || !job.resultAsset)
        throw new AppError("CONFLICT", 409, { reason: "CREDENTIALS_ALREADY_TAKEN" });
      await writeAudit(tx, { action: "import.credentials_downloaded", entityType: "ImportJob", entityId: id });
      return job.resultAsset;
    });
    const buffer = await this.storage.get(asset.storageKey);
    await this.storage.delete(asset.storageKey);
    return { buffer, fileName: asset.originalName };
  }
}
