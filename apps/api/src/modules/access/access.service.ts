import type { Db } from "@idrok/db";
import { PERMISSIONS, SYSTEM_ROLES, isPermissionCode, type RoleDto } from "@idrok/shared";
import { requireTenantId } from "@idrok/db";
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

  private assertPermissions(codes: string[]) {
    const unknown = codes.filter((c) => !isPermissionCode(c));
    if (unknown.length) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "permissions", code: "unknown_permission" }], unknown });
  }

  /** Active holders of a role: their cached permissions must be dropped after any change to it. */
  private async holders(roleId: string) {
    const rows = await this.db.userRole.findMany({ where: { roleId, revokedAt: null }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async createRole(input: { code: string; name: string; permissions: string[] }): Promise<RoleDto> {
    if ((SYSTEM_ROLES as readonly string[]).includes(input.code)) throw new AppError("CONFLICT", 409, { reason: "ROLE_CODE_RESERVED" });
    const permissions = [...new Set(input.permissions)];
    this.assertPermissions(permissions);
    const id = await this.db.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { tenantId: requireTenantId(), code: input.code, name: input.name, isSystem: false } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })) });
      await writeAudit(tx, { action: "role.create", entityType: "Role", entityId: role.id, after: { code: input.code, name: input.name, permissions } });
      return role.id;
    });
    return this.role(id);
  }

  async role(id: string): Promise<RoleDto> {
    const r = await this.db.role.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, code: true, name: true, isSystem: true, permissions: { select: { permissionCode: true } } },
    });
    if (!r) throw new AppError("NOT_FOUND", 404);
    return { ...r, permissions: r.permissions.map((p) => p.permissionCode).sort() };
  }

  async renameRole(id: string, name: string): Promise<RoleDto> {
    await this.db.$transaction(async (tx) => {
      const before = await tx.role.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new AppError("NOT_FOUND", 404);
      await tx.role.update({ where: { id }, data: { name } });
      await writeAudit(tx, { action: "role.rename", entityType: "Role", entityId: id, before: { name: before.name }, after: { name } });
    });
    return this.role(id);
  }

  /**
   * Replaces a role's permissions (RBAC matrix editor). Only a super admin edits SUPER_ADMIN, and nobody can remove
   * their own last way to manage roles (self-lockout).
   */
  async setRolePermissions(actor: RequestAuth, id: string, codes: string[]): Promise<RoleDto> {
    const permissions = [...new Set(codes)].sort();
    this.assertPermissions(permissions);
    const current = await this.role(id);
    if (current.code === "SUPER_ADMIN" && !actor.roles.includes("SUPER_ADMIN")) throw new AppError("FORBIDDEN", 403, { reason: "SUPER_ADMIN_ONLY" });
    if (actor.roles.includes(current.code) && !permissions.includes("roles.manage")) {
      const others = await this.db.role.findMany({
        where: { code: { in: actor.roles.filter((r) => r !== current.code) }, archivedAt: null, permissions: { some: { permissionCode: "roles.manage" } } },
        select: { id: true },
      });
      if (!others.length) throw new AppError("CONFLICT", 409, { reason: "SELF_LOCKOUT" });
    }
    const holders = await this.db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permissionCode) => ({ roleId: id, permissionCode })) });
      const users = (await tx.userRole.findMany({ where: { roleId: id, revokedAt: null }, select: { userId: true } })).map((u) => u.userId);
      if (users.length) await tx.user.updateMany({ where: { id: { in: users } }, data: { authVersion: { increment: 1 } } });
      await writeAudit(tx, {
        action: "role.permissions.update",
        entityType: "Role",
        entityId: id,
        before: { permissions: current.permissions },
        after: { permissions },
      });
      return users;
    });
    await this.authState.invalidate(holders);
    return this.role(id);
  }

  /** Custom roles only; holders lose its permissions immediately (assignments stay as history). */
  async archiveRole(actor: RequestAuth, id: string): Promise<void> {
    const current = await this.role(id);
    if (current.isSystem) throw new AppError("CONFLICT", 409, { reason: "SYSTEM_ROLE" });
    if (actor.roles.includes(current.code)) throw new AppError("CONFLICT", 409, { reason: "SELF_LOCKOUT" });
    await this.db.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { archivedAt: new Date() } });
      await writeAudit(tx, { action: "role.archive", entityType: "Role", entityId: id, before: { code: current.code } });
    });
    await this.authState.invalidate(await this.holders(id));
  }
}
