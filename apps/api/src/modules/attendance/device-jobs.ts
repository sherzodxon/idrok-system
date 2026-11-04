// Device jobs (BridgeJob): created with the change that needs them, executed by the device's bridge (leased by polling)
// or — for terminals the server reaches directly — by the worker ("devices" queue). A lease expires, so a job held by
// a bridge that died is handed out again; after MAX_ATTEMPTS leases it fails. Results update the face sync state and
// the device's health. A newer job for the same face supersedes queued older ones.
import { Prisma, requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type { BridgeJobDto } from "@idrok/shared";
import type { DeviceJobType, JobOutcome } from "@idrok/hikvision";

export const LEASE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 5;

export interface JobDevice {
  id: string;
  useBridge: boolean;
  bridgeAgentId: string | null;
}

/** Inside the caller's transaction; a direct device also gets an outbox event for the worker. */
export async function enqueueDeviceJob(
  tx: DbTransaction,
  device: JobDevice,
  type: DeviceJobType,
  payload: Record<string, unknown>,
  faceSyncId: string | null = null,
): Promise<void> {
  if (faceSyncId) {
    await tx.bridgeJob.updateMany({
      where: { faceSyncId, status: "QUEUED", type: { in: ["FACE_UPSERT", "FACE_DELETE"] } },
      data: { status: "FAILED", error: "superseded", completedAt: new Date() },
    });
  }
  await tx.bridgeJob.create({
    data: {
      tenantId: requireTenantId(),
      bridgeAgentId: device.useBridge ? device.bridgeAgentId : null,
      deviceId: device.id,
      faceSyncId,
      type,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  if (!device.useBridge) {
    await tx.outboxEvent.create({
      data: {
        tenantId: requireTenantId(),
        type: "devices.jobs_due",
        aggregateType: "Device",
        aggregateId: device.id,
        payload: { tenantId: requireTenantId(), deviceId: device.id },
      },
    });
  }
}

/** Hands out up to `max` jobs (queued, or leased with an expired lease) of one bridge or one direct device. */
export async function leaseJobs(
  db: Db,
  owner: { bridgeAgentId: string } | { directDeviceId: string },
  max: number,
  now: Date = new Date(),
): Promise<BridgeJobDto[]> {
  return db.$transaction(async (tx) => {
    const ownerSql =
      "bridgeAgentId" in owner
        ? Prisma.sql`"bridgeAgentId" = ${owner.bridgeAgentId}::uuid`
        : Prisma.sql`"bridgeAgentId" IS NULL AND "deviceId" = ${owner.directDeviceId}::uuid`;
    const rows = await tx.$queryRaw<{ id: string; attempts: number }[]>`
      SELECT "id", "attempts" FROM "BridgeJob"
      WHERE "tenantId" = ${requireTenantId()}::uuid AND ${ownerSql}
        AND ("status" = 'QUEUED' OR ("status" = 'LEASED' AND "leasedUntil" < ${now}))
      ORDER BY "createdAt" LIMIT ${max}
      FOR UPDATE SKIP LOCKED`;
    const exhausted = rows.filter((r) => r.attempts >= MAX_ATTEMPTS).map((r) => r.id);
    if (exhausted.length) {
      await tx.bridgeJob.updateMany({
        where: { id: { in: exhausted } },
        data: { status: "FAILED", error: "no result after repeated leases", completedAt: now },
      });
      const failed = await tx.bridgeJob.findMany({ where: { id: { in: exhausted } }, select: { faceSyncId: true } });
      for (const f of failed) {
        if (f.faceSyncId)
          await tx.faceSyncJob.update({
            where: { id: f.faceSyncId },
            data: { status: "FAILED", lastError: "no result after repeated leases" },
          });
      }
    }
    const ids = rows.filter((r) => r.attempts < MAX_ATTEMPTS).map((r) => r.id);
    if (!ids.length) return [];
    const leasedUntil = new Date(now.getTime() + LEASE_MS);
    await tx.bridgeJob.updateMany({
      where: { id: { in: ids } },
      data: { status: "LEASED", leasedUntil, attempts: { increment: 1 } },
    });
    await tx.faceSyncJob.updateMany({
      where: { jobs: { some: { id: { in: ids } } }, status: "PENDING" },
      data: { status: "IN_PROGRESS" },
    });
    const jobs = await tx.bridgeJob.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { id: true, deviceId: true, type: true, payload: true },
    });
    return jobs.map((j) => ({
      id: j.id,
      deviceId: j.deviceId,
      type: j.type,
      payload: (j.payload ?? {}) as Record<string, unknown>,
      leasedUntil: leasedUntil.toISOString(),
    }));
  });
}

/**
 * Records a job's outcome. Only a leased job of this owner can be completed; an answer for a job that is no longer
 * leased (failed after repeated leases, superseded, archived device) is ignored: false.
 */
export async function completeJob(
  db: Db,
  jobId: string,
  owner: { bridgeAgentId: string } | { direct: true },
  outcome: Pick<JobOutcome, "ok" | "error" | "result">,
  now: Date = new Date(),
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const job = await tx.bridgeJob.findFirst({
      where: {
        id: jobId,
        status: "LEASED",
        bridgeAgentId: "bridgeAgentId" in owner ? owner.bridgeAgentId : null,
      },
      select: {
        id: true,
        type: true,
        payload: true,
        deviceId: true,
        faceSyncId: true,
        device: { select: { serialNumber: true } },
      },
    });
    if (!job) return false;
    const error = outcome.ok ? null : (outcome.error ?? "failed").slice(0, 500);
    await tx.bridgeJob.update({
      where: { id: job.id },
      data: {
        status: outcome.ok ? "DONE" : "FAILED",
        error,
        result: (outcome.result ?? Prisma.DbNull) as Prisma.InputJsonValue,
        completedAt: now,
        leasedUntil: null,
      },
    });
    const result = outcome.result ?? {};
    const hasFace = typeof result.hasFace === "boolean" ? result.hasFace : null;
    if (job.faceSyncId) {
      const sync = await tx.faceSyncJob.findUnique({ where: { id: job.faceSyncId } });
      const payload = (job.payload ?? {}) as { version?: number };
      if (sync && job.type === "FACE_CHECK") {
        await tx.faceSyncJob.update({
          where: { id: sync.id },
          data: outcome.ok ? { lastCheckedAt: now, deviceHasFace: hasFace } : { lastCheckedAt: now, lastError: error },
        });
      } else if (sync && (job.type === "FACE_UPSERT" || job.type === "FACE_DELETE")) {
        // Only the job for the current state of the face moves the sync row.
        const current =
          (job.type === "FACE_UPSERT" && sync.action === "UPSERT" && sync.version === (payload.version ?? null)) ||
          (job.type === "FACE_DELETE" && sync.action === "DELETE");
        if (current) {
          await tx.faceSyncJob.update({
            where: { id: sync.id },
            data: outcome.ok
              ? {
                  status: "SYNCED",
                  syncedVersion: job.type === "FACE_UPSERT" ? sync.version : null,
                  syncedAt: now,
                  lastError: null,
                  deviceHasFace: hasFace,
                  lastCheckedAt: now,
                  attempts: { increment: 1 },
                }
              : { status: "FAILED", lastError: error, attempts: { increment: 1 } },
          });
        }
      }
    }
    if (job.type === "DEVICE_INFO" && outcome.ok) {
      const serial = typeof result.serialNumber === "string" ? result.serialNumber : null;
      const mismatch = serial && job.device.serialNumber && serial !== job.device.serialNumber;
      await tx.device.update({
        where: { id: job.deviceId },
        data: {
          model: typeof result.model === "string" ? result.model : undefined,
          firmware: typeof result.firmwareVersion === "string" ? result.firmwareVersion : undefined,
          serialNumber: job.device.serialNumber ?? serial ?? undefined,
          lastError: mismatch ? `serial number mismatch: device reports ${serial}` : null,
          lastSeenAt: now,
        },
      });
    } else {
      await tx.device.update({
        where: { id: job.deviceId },
        data: outcome.ok ? { lastSeenAt: now, lastError: null } : { lastError: error },
      });
    }
    return true;
  });
}
