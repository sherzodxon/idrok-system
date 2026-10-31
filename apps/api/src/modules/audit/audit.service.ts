// Audit entries are written with the same transaction client as the change they record (CLAUDE.md §4).
import { currentTenantContext, type Prisma } from "@idrok/db";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Defaults to the request context; required where there is none yet (login). */
  tenantId?: string;
  actorUserId?: string | null;
}

interface AuditWriter {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> };
}

const json = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

export async function writeAudit(client: AuditWriter, entry: AuditEntry): Promise<void> {
  const ctx = currentTenantContext();
  const tenantId = entry.tenantId ?? ctx?.tenantId;
  if (!tenantId) throw new Error("writeAudit needs a tenant");
  await client.auditLog.create({
    data: {
      tenantId,
      actorUserId: entry.actorUserId === undefined ? (ctx?.userId ?? null) : entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason ?? null,
      requestId: ctx?.requestId ?? null,
    },
  });
}
