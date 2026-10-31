import type { Db } from "@idrok/db";
import { PERMISSIONS, type RoleDto } from "@idrok/shared";
import { AppError } from "../../http/errors";
import type { RequestAuth } from "../../http/auth";
import { writeAudit } from "../audit/audit.service";
import type { AuthStateStore } from "./auth-state";

export class AccessService {
  constructor(
    private readonly db: Db,
    private readonly authState: AuthStateStore,
  ) {}

  permissions() {
    return PERMISSIONS.map((p) => ({ code: p.code, module: p.module }));
  }

  async roles(): Promise<RoleDto[]> {
    const roles = await this.db.role.findMany({
      where: { archivedAt: null },
      orderBy: [{ isSystem: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, isSystem: true, permissions: { select: { permissionCode: true } } },
    });
    return roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permissionCode).sort() }));
  }

  /** Replaces the user's active roles. Revoked assignments stay as history. */
  async assignRoles(actor: RequestAuth, userId: string, roleIds: string[]): Promise<string[]> {
    const wanted = [...new Set(roleIds)];
    const result = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new AppError("NOT_FOUND", 404);
      const roles = await tx.role.findMany({
        where: { id: { in: wanted }, archivedAt: null },
        select: { id: true, code: true },
      });
      if (roles.length !== wanted.length)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "roleIds", code: "unknown_role" }] });
      // Only a super admin hands out super admin.
      if (roles.some((r) => r.code === "SUPER_ADMIN") && !actor.roles.includes("SUPER_ADMIN")) {
        throw new AppError("FORBIDDEN", 403, { reason: "SUPER_ADMIN_ONLY" });
      }

      const current = await tx.userRole.findMany({
        where: { userId, revokedAt: null },
        select: { id: true, roleId: true, role: { select: { code: true } } },
      });
      const toRevoke = current.filter((c) => !wanted.includes(c.roleId));
      const toAdd = wanted.filter((id) => !current.some((c) => c.roleId === id));
      if (toRevoke.length) {
        await tx.userRole.updateMany({
          where: { id: { in: toRevoke.map((r) => r.id) } },
          data: { revokedAt: new Date() },
        });
      }
      if (toAdd.length) {
        await tx.userRole.createMany({
          data: toAdd.map((roleId) => ({ tenantId: actor.tenantId, userId, roleId, assignedById: actor.userId })),
        });
      }
      await tx.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
      const after = roles.map((r) => r.code).sort();
      await writeAudit(tx, {
        action: "user.roles.update",
        entityType: "User",
        entityId: userId,
        before: { roles: current.map((c) => c.role.code).sort() },
        after: { roles: after },
      });
      return after;
    });
    await this.authState.invalidate([userId]);
    return result;
  }
}
