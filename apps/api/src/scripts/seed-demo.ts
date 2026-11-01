// Demo school for local development and staging (Q-30: synthetic data only — never on a server with real data).
// Run after `seed` (it needs the tenant and its admin): pnpm --filter @idrok/api seed:demo
// Prints counts only; no passwords are printed or stored.
import { createDb, createRootClient, runWithTenant } from "@idrok/db";
import { configurePasswordHashing } from "../modules/auth/password";
import { DemoAlreadySeededError, seedDemoSchool } from "../modules/demo/demo-seed";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--yes-i-understand")) {
  console.error("Refusing to seed demo data in production without --yes-i-understand.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const slug = process.env.DEFAULT_TENANT_SLUG ?? "idrok";
// Same password cost as the API (ARGON2_MEMORY_KIB, default 19456).
const memory = Number(process.env.ARGON2_MEMORY_KIB);
if (memory >= 1024) configurePasswordHashing(memory);

const root = createRootClient({ url, max: 2 });
const db = createDb({ url, max: 2 });
try {
  const tenant = await root.tenant.findUnique({ where: { slug } });
  const admin =
    tenant &&
    (await root.user.findUnique({ where: { tenantId_username: { tenantId: tenant.id, username: "admin" } } }));
  if (!tenant || !admin) {
    console.error(`Tenant "${slug}" or its admin does not exist: run the seed first.`);
    process.exitCode = 1;
  } else {
    const roles = await root.userRole.findMany({
      where: { userId: admin.id, revokedAt: null },
      select: { role: { select: { code: true } } },
    });
    const actor = { userId: admin.id, roles: roles.map((r) => r.role.code) };
    const started = Date.now();
    const summary = await runWithTenant({ tenantId: tenant.id, userId: admin.id, requestId: "seed:demo" }, () =>
      seedDemoSchool(db, actor),
    );
    console.log(`Demo school ready in ${Math.round((Date.now() - started) / 1000)} s:`, summary);
    console.log("Account passwords are random and not shown; reset the ones you need in Settings → Users.");
  }
} catch (err) {
  if (!(err instanceof DemoAlreadySeededError)) throw err;
  console.log(err.message);
} finally {
  await Promise.all([root.$disconnect(), db.$disconnect()]);
}
