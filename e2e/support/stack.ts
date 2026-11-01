// Starts the whole stack for end-to-end tests: embedded Postgres, Redis, demo seed, the API (tsx) and the built web
// app (`next start`). Only synthetic data; never touches a real database (startTestDatabase refuses non-local hosts).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import argon2 from "argon2";
import { createRootClient } from "@idrok/db";
import { ensureSystemRoles, syncPermissions } from "@idrok/db/seed";
import { startTestDatabase } from "@idrok/db/testing";
import { parseSchoolDate, schoolDateToDb } from "@idrok/shared/time";
import { RedisMemoryServer } from "redis-memory-server";
import { API_URL, PASSWORD, PORTS, TEMP_PASSWORD, USERS, WEB_URL } from "./users";

const day = (d: string) => schoolDateToDb(parseSchoolDate(d));

const ROOT = path.resolve(import.meta.dirname, "../..");

async function waitFor(url: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function seed(url: string) {
  const root = createRootClient({ url, max: 2 });
  try {
    await syncPermissions(root);
    const tenant = await root.tenant.create({ data: { slug: "idrok", name: "Demo maktab" } });
    const tenantId = tenant.id;
    await root.schoolSettings.create({ data: { tenantId } });
    await root.schoolBranding.create({ data: { tenantId, schoolName: "Demo maktab" } });
    const roles = await ensureSystemRoles(root, tenantId);
    const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });

    const staff = async (username: string, mustChangePassword: boolean) => {
      const user = await root.user.create({
        data: {
          tenantId,
          username,
          passwordHash: await hash(mustChangePassword ? TEMP_PASSWORD : PASSWORD),
          mustChangePassword,
        },
      });
      await root.userRole.create({ data: { tenantId, userId: user.id, roleId: roles.SCHOOL_ADMIN } });
      await root.employee.create({
        data: { tenantId, userId: user.id, firstName: "Demo", lastName: username.split(".")[1] ?? "Admin" },
      });
    };
    await staff(USERS.firstLogin, true);
    for (const u of [USERS.theme, USERS.branding, USERS.sidebar, USERS.mobile, USERS.importer]) await staff(u, false);
    // A teacher with no groups yet: sees the teacher menu only, and empty states.
    const teacher = await root.user.create({
      data: { tenantId, username: USERS.teacher, passwordHash: await hash(PASSWORD), mustChangePassword: false },
    });
    await root.userRole.create({ data: { tenantId, userId: teacher.id, roleId: roles.TEACHER } });
    await root.employee.create({ data: { tenantId, userId: teacher.id, firstName: "Demo", lastName: "Ustoz" } });

    // A guardian with one enrolled child for the portal.
    const year = await root.academicYear.create({
      data: { tenantId, name: "2026-2027", startDate: day("2026-09-01"), endDate: day("2027-06-30"), status: "ACTIVE" },
    });
    const grade = await root.grade.create({ data: { tenantId, level: 7, name: "7" } });
    const cls = await root.classGroup.create({
      data: { tenantId, academicYearId: year.id, gradeId: grade.id, section: "A", name: "7-A" },
    });
    // Every class has its whole-class teaching group, as the API creates it.
    await root.teachingGroup.create({
      data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: "7-A" },
    });
    const student = await root.student.create({
      data: { tenantId, studentCode: "STD-0001", firstName: "Demo", lastName: "Farzand" },
    });
    await root.studentEnrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        academicYearId: year.id,
        classGroupId: cls.id,
        validFrom: day("2026-09-01"),
      },
    });
    const guardianUser = await root.user.create({
      data: { tenantId, username: USERS.guardian, passwordHash: await hash(PASSWORD), mustChangePassword: false },
    });
    await root.userRole.create({ data: { tenantId, userId: guardianUser.id, roleId: roles.GUARDIAN } });
    const guardian = await root.guardian.create({
      data: { tenantId, userId: guardianUser.id, firstName: "Demo", lastName: "Ona", phone: USERS.guardian },
    });
    await root.studentGuardian.create({
      data: { tenantId, studentId: student.id, guardianId: guardian.id, relation: "MOTHER" },
    });
  } finally {
    await root.$disconnect();
  }
}

function start(name: string, command: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  child.stdout?.on("data", (d: Buffer) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  return child;
}

export async function startStack() {
  const db = await startTestDatabase();
  // CI provides Redis as a service container; locally an in-memory server is started.
  const redis = process.env.TEST_REDIS_URL ? null : await RedisMemoryServer.create();
  const redisUrl = process.env.TEST_REDIS_URL ?? `redis://127.0.0.1:${await redis!.getPort()}`;
  await seed(db.url);

  // API and worker share one storage folder (uploads written by the API are parsed by the worker).
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "idrok-e2e-storage-"));
  const serverEnv = {
    NODE_ENV: "test",
    PORT: String(PORTS.api),
    DATABASE_URL: db.url,
    REDIS_URL: redisUrl,
    JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
    CORS_ORIGINS: WEB_URL,
    COOKIE_SECURE: "false",
    LOG_LEVEL: "silent",
    DEFAULT_TENANT_SLUG: "idrok",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: storageDir,
    // Imports hash hundreds of temporary passwords; production keeps the default cost.
    ARGON2_MEMORY_KIB: "4096",
  };
  const api = start(
    "api",
    process.execPath,
    ["--import", "tsx", "src/main.ts"],
    path.join(ROOT, "apps/api"),
    serverEnv,
  );
  const worker = start(
    "worker",
    process.execPath,
    ["--import", "tsx", "src/main.ts"],
    path.join(ROOT, "apps/worker"),
    serverEnv,
  );
  await waitFor(`${API_URL}/healthz`);

  const nextBin = path.join(ROOT, "apps/web/node_modules/next/dist/bin/next");
  const web = start("web", process.execPath, [nextBin, "start", "-p", String(PORTS.web)], path.join(ROOT, "apps/web"), {
    API_PUBLIC_URL: API_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  });
  await waitFor(`${WEB_URL}/login`);

  return async () => {
    for (const p of [web, worker, api]) p.kill("SIGTERM");
    await redis?.stop();
    await db.stop();
    rmSync(storageDir, { recursive: true, force: true });
  };
}
