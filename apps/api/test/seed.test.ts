// security-baseline.md S3: the seed prints the admin password only to an interactive terminal and needs an explicit
// flag in production. Here stdout is a pipe, i.e. not interactive.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, inject, it } from "vitest";

const SEED = path.join(import.meta.dirname, "../src/scripts/seed.ts");

function runSeed(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync(process.execPath, ["--import", "tsx", SEED, ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: inject("databaseUrl"), ...env },
    encoding: "utf8",
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

describe("seed script", () => {
  it("does not create or print an admin password when stdout is not a terminal", () => {
    const { status, output } = runSeed({ DEFAULT_TENANT_SLUG: `seed-${randomUUID()}` });
    expect(status).toBe(1);
    expect(output).toMatch(/interactive terminal/);
    expect(output).not.toMatch(/temporary password:/i);
  });

  it("refuses to run in production without --yes-i-understand", () => {
    const { status, output } = runSeed({ NODE_ENV: "production", DEFAULT_TENANT_SLUG: `seed-${randomUUID()}` });
    expect(status).toBe(1);
    expect(output).toMatch(/--yes-i-understand/);
  });
}, 60_000);
