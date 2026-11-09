// The restore drill's checklist (scripts/backup/verify.sql) must keep running on the current schema: a renamed table
// or column would otherwise only be found during a real restore.
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl } from "./helpers";

const sql = readFileSync(path.join(import.meta.dirname, "../../../scripts/backup/verify.sql"), "utf8");
let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
});
afterAll(() => client.end());

describe("backup verify.sql", () => {
  it("runs on the migrated schema and prints counts only", async () => {
    const { rows } = await client.query<{ item: string; value: string }>(sql);
    expect(rows.map((r) => r.item)).toEqual([
      "migrations",
      "tenants",
      "students",
      "employees",
      "score entries",
      "score sum",
      "coin transactions",
      "coin sum",
      "access events",
      "test attempts",
      "audit rows",
      "latest audit",
    ]);
    expect(Number(rows[0]!.value)).toBeGreaterThan(10);
  });
});
