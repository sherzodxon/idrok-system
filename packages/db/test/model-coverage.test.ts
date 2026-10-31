// Every model must be classified for tenant isolation; a new model that is forgotten fails here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBAL_MODELS, PARENT_SCOPED_MODELS, TENANT_SCOPED_MODELS } from "../src/tenant-models";

const schema = readFileSync(path.join(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
  name: m[1]!,
  hasTenantId: /^\s+tenantId\s+String/m.test(m[2]!),
}));

describe("tenant model coverage", () => {
  it("lists every schema model exactly once", () => {
    const listed = [...TENANT_SCOPED_MODELS, ...PARENT_SCOPED_MODELS, ...GLOBAL_MODELS] as string[];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(models.map((m) => m.name).sort());
  });

  it("scopes exactly the models that have a tenantId column", () => {
    const withTenant = models
      .filter((m) => m.hasTenantId)
      .map((m) => m.name)
      .sort();
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(withTenant);
  });
});
