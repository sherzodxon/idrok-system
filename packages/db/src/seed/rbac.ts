// Keeps the Permission table and the system roles in line with packages/shared (permissions.ts, role-defaults.ts).
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, SYSTEM_ROLES, type SystemRoleCode } from "@idrok/shared";
import type { RootClient } from "../client";

/** Adds new permission codes; codes removed from the catalogue are marked deprecated, never deleted. */
export async function syncPermissions(root: RootClient): Promise<void> {
  const codes = PERMISSIONS.map((p) => p.code as string);
  await root.$transaction([
    ...PERMISSIONS.map((p) =>
      root.permission.upsert({
        where: { code: p.code },
        create: { code: p.code, module: p.module },
        update: { module: p.module, deprecated: false },
      }),
    ),
    root.permission.updateMany({ where: { code: { notIn: codes } }, data: { deprecated: true } }),
  ]);
}

/** i18n keys of the system role names (translated in the web app). */
const roleName = (code: SystemRoleCode) => `roles.${code}`;

/**
 * Creates missing system roles with their default permissions. Existing roles are left as the school configured them,
 * unless `resetPermissions` is set (used for brand-new tenants and tests).
 */
export async function ensureSystemRoles(
  root: RootClient,
  tenantId: string,
  options: { resetPermissions?: boolean } = {},
): Promise<Record<SystemRoleCode, string>> {
  const ids = {} as Record<SystemRoleCode, string>;
  for (const code of SYSTEM_ROLES) {
    const existing = await root.role.findUnique({ where: { tenantId_code: { tenantId, code } } });
    const role =
      existing ?? (await root.role.create({ data: { tenantId, code, name: roleName(code), isSystem: true } }));
    ids[code] = role.id;
    if (!existing || options.resetPermissions) {
      await root.$transaction([
        root.rolePermission.deleteMany({ where: { roleId: role.id } }),
        root.rolePermission.createMany({
          data: ROLE_DEFAULT_PERMISSIONS[code].map((permissionCode) => ({ roleId: role.id, permissionCode })),
        }),
      ]);
    }
  }
  return ids;
}
