// Tenant isolation at the Prisma level (architecture.md §5). Fail-closed: a tenant-scoped query without a tenant
// context throws. Raw SQL ($queryRaw/$executeRaw) is not covered — it is allowed only in repositories, with tenantId.
import { Prisma } from "./generated/prisma/client";
import { TenantContextMissingError, TenantMismatchError, currentTenantContext } from "./context";
import { isTenantScopedModel } from "./tenant-models";

type Args = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

function stampData(model: string, data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => stampData(model, row, tenantId));
  if (data === null || typeof data !== "object") return data;
  const row = data as Args;
  if (row.tenantId !== undefined && row.tenantId !== tenantId) throw new TenantMismatchError(model);
  // A relation-style create (`tenant: { connect }`) is rejected too: the tenant always comes from the context.
  if (row.tenant !== undefined) throw new TenantMismatchError(model);
  return { ...row, tenantId };
}

function scopeWhere(where: unknown, tenantId: string, unique: boolean): Args {
  const base = (where ?? {}) as Args;
  // findUnique/update/delete/upsert accept extra non-unique filters next to the unique key. Asking for another
  // tenant's id simply matches nothing (no error, no information leak).
  return unique ? { ...base, tenantId } : { AND: [base, { tenantId }] };
}

const UNIQUE_WHERE = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

export const tenantExtension = Prisma.defineExtension({
  name: "tenant-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantScopedModel(model)) return query(args);
        const context = currentTenantContext();
        if (!context) throw new TenantContextMissingError(model, operation);
        const { tenantId } = context;
        const next = { ...(args as Args) };

        if (WHERE_OPERATIONS.has(operation)) {
          next.where = scopeWhere(next.where, tenantId, UNIQUE_WHERE.has(operation));
        }
        if (CREATE_OPERATIONS.has(operation)) {
          next.data = stampData(model, next.data, tenantId);
        }
        if (operation === "upsert") {
          next.create = stampData(model, next.create, tenantId);
          if ((next.update as Args | undefined)?.tenantId !== undefined) throw new TenantMismatchError(model);
        }
        if (
          (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") &&
          next.data
        ) {
          const data = next.data as Args;
          if (data.tenantId !== undefined || data.tenant !== undefined) throw new TenantMismatchError(model);
        }
        return query(next as typeof args);
      },
    },
  },
});
