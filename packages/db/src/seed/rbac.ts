// Keeps the Permission table and the system roles in line with packages/shared (permissions.ts, role-defaults.ts).
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, SYSTEM_ROLES, type SystemRoleCode } from "@idrok/shared";
import type { RootClient } from "../client";

/**
 * Adds new permission codes; codes removed from the catalogue are marked deprecated, never deleted. A code that is new
 * to the database is also granted once to every tenant's system roles whose defaults include it — otherwise a school
 * seeded before a stage would never get that stage's permissions. Returns the newly added codes.
 */
export async function syncPermissions(root: RootClient): Promise<string[]> {
  const codes = PERMISSIONS.map((p) => p.code as string);
  const known = new Set((await root.permission.findMany({ select: { code: true } })).map((p) => p.code));
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
  const added = codes.filter((c) => !known.has(c));
  // On an empty database there are no roles yet; ensureSystemRoles gives new roles their full defaults.
  if (added.length && known.size) await grantNewDefaults(root, added);
  return added;
}

/** Grants newly introduced codes to existing system roles by their defaults; schools' own changes stay untouched. */
export async function grantNewDefaults(root: RootClient, codes: string[]): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    const grant = ROLE_DEFAULT_PERMISSIONS[role].filter((c) => codes.includes(c));
    if (!grant.length) continue;
    const roles = await root.role.findMany({ where: { code: role, isSystem: true }, select: { id: true } });
    if (!roles.length) continue;
    await root.rolePermission.createMany({
      data: roles.flatMap((r) => grant.map((permissionCode) => ({ roleId: r.id, permissionCode }))),
      skipDuplicates: true,
    });
  }
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
