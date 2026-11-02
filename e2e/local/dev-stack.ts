// Runs the whole system on this computer with synthetic demo data only (Q-30), no Docker, Render or Supabase needed:
// a persistent embedded PostgreSQL in `.localdb/`, an in-memory Redis, the demo school, then the API, the worker and
// the web app in dev mode. Ctrl+C stops everything; the database survives until `.localdb/` is deleted.
//
//   pnpm --filter @idrok/e2e local
//
// The admin, the first demo teacher and the first demo guardian get the local password from LOCAL_PASSWORD (default:
// the e2e demo password in support/users.ts). Only usernames are printed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { createRootClient } from "@idrok/db";
import { ensureSystemRoles, syncPermissions } from "@idrok/db/seed";
import { startLocalDatabase } from "@idrok/db/testing";
import { RedisMemoryServer } from "redis-memory-server";
import { PASSWORD } from "../support/users";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORTS = { db: 54339, redis: 63799, api: 4000, web: 3000 };
const WEB_URL = `http://localhost:${PORTS.web}`;
const API_URL = `http://localhost:${PORTS.api}/api/v1`;
const localPassword = process.env.LOCAL_PASSWORD ?? PASSWORD;

function run(name: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = (d: Buffer) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((l) => `[${name}] ${l}\n`)
      .join("");
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(prefix(d)));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(prefix(d)));
  return child;
}

const finished = (child: ChildProcess) =>
  new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

async function waitFor(url: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Tenant, roles and the admin account (with the local password), once. */
async function bootstrap(url: string) {
  const root = createRootClient({ url, max: 2 });
  try {
    await syncPermissions(root);
    const tenant =
      (await root.tenant.findUnique({ where: { slug: "idrok" } })) ??
      (await root.tenant.create({ data: { slug: "idrok", name: "Idrok (demo)" } }));
    const tenantId = tenant.id;
    await root.schoolSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    await root.schoolBranding.upsert({
      where: { tenantId },
      create: { tenantId, schoolName: "Idrok (demo)" },
      update: {},
    });
    const roles = await ensureSystemRoles(root, tenantId);
    if (!(await root.user.findUnique({ where: { tenantId_username: { tenantId, username: "admin" } } }))) {
      const admin = await root.user.create({
        data: {
          tenantId,
          username: "admin",
          passwordHash: await argon2.hash(localPassword, { type: argon2.argon2id }),
        },
      });
      await root.userRole.create({ data: { tenantId, userId: admin.id, roleId: roles.SCHOOL_ADMIN } });
    }
    return tenantId;
  } finally {
    await root.$disconnect();
  }
}

/** The first demo teacher and guardian get the local password, so every view can be tried. */
async function localAccounts(url: string, tenantId: string) {
  const root = createRootClient({ url, max: 2 });
  try {
    const firstWith = (code: string) =>
      root.user.findFirst({
        where: { tenantId, roles: { some: { revokedAt: null, role: { code } } } },
        orderBy: { username: "asc" },
        select: { id: true, username: true },
      });
    const accounts = [
      { role: "admin", user: await root.user.findFirst({ where: { tenantId, username: "admin" } }) },
      { role: "teacher", user: await firstWith("TEACHER") },
      { role: "guardian", user: await firstWith("GUARDIAN") },
    ];
    const passwordHash = await argon2.hash(localPassword, { type: argon2.argon2id });
    for (const a of accounts) {
      if (!a.user) continue;
      await root.user.update({ where: { id: a.user.id }, data: { passwordHash, mustChangePassword: false } });
      console.log(`  ${a.role.padEnd(9)} ${a.user.username}`);
    }
  } finally {
    await root.$disconnect();
  }
}

const dataDir = path.join(ROOT, ".localdb/pg");
mkdirSync(dataDir, { recursive: true });
const db = await startLocalDatabase(dataDir, PORTS.db);
const redis = await RedisMemoryServer.create({ instance: { port: PORTS.redis } });
const env = {
  NODE_ENV: "development",
  PORT: String(PORTS.api),
  DATABASE_URL: db.url,
  REDIS_URL: `redis://127.0.0.1:${await redis.getPort()}`,
  JWT_SECRET: "local-dev-secret-local-dev-secret-0001",
  CORS_ORIGINS: WEB_URL,
  COOKIE_SECURE: "false",
  LOG_LEVEL: process.env.LOCAL_LOG_LEVEL ?? "warn",
  DEFAULT_TENANT_SLUG: "idrok",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: path.join(ROOT, ".localdb/storage"),
  ARGON2_MEMORY_KIB: "4096",
};

const tenantId = await bootstrap(db.url);
// The demo seed refuses to run twice, so later starts keep the data (and whatever was changed in the UI).
const seeded = await finished(
  run("seed", ["--import", "tsx", "src/scripts/seed-demo.ts"], path.join(ROOT, "apps/api"), env),
);
if (seeded !== 0) throw new Error("demo seed failed");
console.log("Local accounts (password: LOCAL_PASSWORD or the e2e demo password):");
await localAccounts(db.url, tenantId);

const children = [
  run("api", ["--import", "tsx", "src/main.ts"], path.join(ROOT, "apps/api"), env),
  run("worker", ["--import", "tsx", "src/main.ts"], path.join(ROOT, "apps/worker"), env),
];
await waitFor(`${API_URL}/healthz`);
const nextBin = path.join(ROOT, "apps/web/node_modules/next/dist/bin/next");
children.push(
  run("web", [nextBin, "dev", "-p", String(PORTS.web)], path.join(ROOT, "apps/web"), {
    API_PUBLIC_URL: API_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  }),
);
await waitFor(`${WEB_URL}/login`);
console.log(`\nIdrok is running: ${WEB_URL}  (API ${API_URL})  — Ctrl+C to stop.`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  await redis.stop();
  await db.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
