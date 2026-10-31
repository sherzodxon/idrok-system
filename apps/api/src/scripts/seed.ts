// Bootstrap: permissions, the school tenant, its system roles and one admin account.
// Idempotent. The admin's temporary password is printed ONCE (only when the account is created) and must be changed
// at first login. Demo data (classes, students) is generated separately in step 8 — synthetic only (Q-30).
import { createRootClient } from "@idrok/db";
import { ensureSystemRoles, syncPermissions } from "@idrok/db/seed";
import { generateTemporaryPassword, hashPassword } from "../modules/auth/password";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const slug = process.env.DEFAULT_TENANT_SLUG ?? "idrok";
const schoolName = process.env.SEED_SCHOOL_NAME ?? "Idrok";

const root = createRootClient({ url, max: 2 });
try {
  await syncPermissions(root);
  const tenant =
    (await root.tenant.findUnique({ where: { slug } })) ??
    (await root.tenant.create({ data: { slug, name: schoolName } }));
  await root.schoolSettings.upsert({ where: { tenantId: tenant.id }, create: { tenantId: tenant.id }, update: {} });
  await root.schoolBranding.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, schoolName },
    update: {},
  });
  const roles = await ensureSystemRoles(root, tenant.id);

  const existing = await root.user.findUnique({
    where: { tenantId_username: { tenantId: tenant.id, username: "admin" } },
  });
  if (existing) {
    console.log(`Tenant "${slug}" is ready; admin account already exists.`);
  } else {
    const password = generateTemporaryPassword();
    await root.$transaction(async (tx) => {
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          username: "admin",
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      });
      await tx.userRole.create({ data: { tenantId: tenant.id, userId: admin.id, roleId: roles.SCHOOL_ADMIN } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, action: "seed.admin_created", entityType: "User", entityId: admin.id },
      });
    });
    console.log(`Tenant "${slug}" created. Admin login: admin / temporary password: ${password}`);
    console.log("The password is shown only now and must be changed at first login.");
  }
} finally {
  await root.$disconnect();
}
