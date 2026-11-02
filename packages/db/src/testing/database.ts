// Isolated databases for integration tests. Never reads .env: either TEST_DATABASE_URL (CI service container) or an
// embedded PostgreSQL in a temp directory. Each call creates a fresh, uniquely named database and migrates it.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const DB_PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface TestDatabase {
  url: string;
  stop(): Promise<void>;
}

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`Refusing to use a non-local test database: ${host}`);
}

async function withAdmin<T>(adminUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function migrate(url: string): Promise<void> {
  const prismaCli = require.resolve("prisma/build/index.js");
  await run(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const name = `idrok_test_${randomBytes(4).toString("hex")}`;
  let serverUrl: string;
  let stopServer = async () => {};

  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    assertLocal(external);
    serverUrl = external;
  } else {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = mkdtempSync(path.join(tmpdir(), "idrok-pg-"));
    const port = 55000 + Math.floor(Math.random() * 5000);
    const server = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    serverUrl = `postgresql://postgres:postgres@localhost:${port}/postgres`;
    stopServer = async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  await withAdmin(serverUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await migrate(url.toString());

  return {
    url: url.toString(),
    async stop() {
      await withAdmin(serverUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
      await stopServer();
    },
  };
}

/**
 * A persistent embedded PostgreSQL for local development (`pnpm --filter @idrok/e2e local`): the data stays in `dir`
 * between runs. Synthetic data only; migrations are applied on every start.
 */
export async function startLocalDatabase(dir: string, port: number): Promise<TestDatabase> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) await server.initialise();
  await server.start();
  const url = `postgresql://postgres:postgres@localhost:${port}/idrok`;
  await withAdmin(`postgresql://postgres:postgres@localhost:${port}/postgres`, async (c) => {
    const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = 'idrok'");
    if (!rowCount) await c.query('CREATE DATABASE "idrok"');
  });
  await migrate(url);
  return { url, stop: () => server.stop() };
}

/** Empties every table (TRUNCATE does not fire the append-only row triggers). */
export async function truncateAll(url: string): Promise<void> {
  await withAdmin(url, async (c) => {
    const { rows } = await c.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  });
}
