import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantContextMissingError, TenantMismatchError } from "../src";
import { asTenant, clients, seedTwoTenants } from "./helpers";

const { root, db } = clients();
let a: string;
let b: string;

beforeAll(async () => {
  ({ a, b } = await seedTwoTenants(root));
});
afterAll(async () => {
  await root.$disconnect();
  await db.$disconnect();
});

describe("tenant extension", () => {
  it("fails closed without a tenant context", async () => {
    await expect(db.subject.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it("findMany and count see only the current tenant", async () => {
    const names = await asTenant(a, () => db.subject.findMany({ select: { tenantId: true } }));
    expect(names.length).toBe(2);
    expect(names.every((s) => s.tenantId === a)).toBe(true);
    expect(await asTenant(b, () => db.subject.count())).toBe(2);
  });

  it("an explicit foreign tenantId in where matches nothing", async () => {
    expect(await asTenant(a, () => db.subject.findMany({ where: { tenantId: b } }))).toEqual([]);
  });

  it("findUnique by id of another tenant's row returns null", async () => {
    const foreign = await root.subject.findFirstOrThrow({ where: { tenantId: b } });
    expect(await asTenant(a, () => db.subject.findUnique({ where: { id: foreign.id } }))).toBeNull();
  });

  it("update and delete of another tenant's row do nothing", async () => {
    const foreign = await root.subject.findFirstOrThrow({ where: { tenantId: b } });
    await expect(
      asTenant(a, () => db.subject.update({ where: { id: foreign.id }, data: { shortName: "x" } })),
    ).rejects.toThrow();
    const res = await asTenant(a, () => db.subject.updateMany({ where: { id: foreign.id }, data: { shortName: "x" } }));
    expect(res.count).toBe(0);
    expect((await asTenant(a, () => db.subject.deleteMany({ where: { id: foreign.id } }))).count).toBe(0);
    expect((await root.subject.findUniqueOrThrow({ where: { id: foreign.id } })).shortName).toBeNull();
  });

  it("create stamps the tenant from the context", async () => {
    const s = await asTenant(a, () => db.subject.create({ data: { name: "Yangi demo fan" } as never }));
    expect(s.tenantId).toBe(a);
  });

  it("create with a different tenantId is rejected", async () => {
    await expect(
      asTenant(a, () => db.subject.create({ data: { tenantId: b, name: "Begona" } })),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });

  it("update cannot move a row to another tenant", async () => {
    const own = await root.subject.findFirstOrThrow({ where: { tenantId: a } });
    await expect(
      asTenant(a, () => db.subject.update({ where: { id: own.id }, data: { tenantId: b } })),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });

  it("interactive transactions stay scoped", async () => {
    const count = await asTenant(a, () => db.$transaction((tx) => tx.subject.count({ where: { tenantId: b } })));
    expect(count).toBe(0);
  });

  it("global models are not scoped", async () => {
    expect(await db.tenant.count()).toBeGreaterThanOrEqual(2);
  });
});
