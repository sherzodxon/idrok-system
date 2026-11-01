import type { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@idrok/db";
import { AuditLogEntrySchema, ListQuerySchema, SchoolDateSchema, pageOf } from "@idrok/shared";
import { addSchoolDays, startOfSchoolDay } from "@idrok/shared/time";
import type { AppDeps } from "../../deps";
import { page, skipTake } from "../../http/pagination";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { schoolClock } from "../access/school-clock";

const AuditQuerySchema = ListQuerySchema.extend({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  from: SchoolDateSchema.optional(),
  to: SchoolDateSchema.optional(),
});

export function auditRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  routesFor(router, registry)(
    {
      method: "get",
      path: "/audit-logs",
      summary: "Audit trail (newest first); dates are school days",
      tags: ["audit"],
      access: "audit_logs.view",
      query: AuditQuerySchema,
      responses: { 200: { description: "Entries", schema: pageOf(AuditLogEntrySchema) } },
    },
    async ({ res, query: q }) => {
      const { timezone } = await schoolClock(deps.db);
      const where: Prisma.AuditLogWhereInput = {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: startOfSchoolDay(q.from, timezone) } : {}),
                ...(q.to ? { lt: startOfSchoolDay(addSchoolDays(q.to, 1), timezone) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        deps.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q) }),
        deps.db.auditLog.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
      const actors = new Map(
        (await deps.db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } })).map((u) => [u.id, u]),
      );
      res.json(
        page(
          rows.map((r) => ({
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
            reason: r.reason,
            before: r.before,
            after: r.after,
          })),
          total,
          q,
        ),
      );
    },
  );
}
