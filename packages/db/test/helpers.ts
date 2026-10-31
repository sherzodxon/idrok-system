import { inject } from "vitest";
import { createDb, createRootClient, runWithTenant, type Db, type RootClient } from "../src";

export const databaseUrl = () => inject("databaseUrl");

export function clients(): { root: RootClient; db: Db } {
  const url = databaseUrl();
  return { root: createRootClient({ url, max: 2 }), db: createDb({ url, max: 2 }) };
}

/** Two tenants with a little data each; returns their ids. */
export async function seedTwoTenants(root: RootClient) {
  const a = await root.tenant.create({ data: { slug: `a-${crypto.randomUUID()}`, name: "Demo A" } });
  const b = await root.tenant.create({ data: { slug: `b-${crypto.randomUUID()}`, name: "Demo B" } });
  for (const t of [a, b]) {
    await root.subject.createMany({
      data: [
        { tenantId: t.id, name: "Demo fan 1" },
        { tenantId: t.id, name: "Demo fan 2" },
      ],
    });
  }
  return { a: a.id, b: b.id };
}

export const asTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithTenant({ tenantId }, fn);
