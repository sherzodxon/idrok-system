import { AsyncLocalStorage } from "node:async_hooks";

/** Who is acting. Set from the verified token by the API, or by a worker from the job payload. */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, () => {
    const result = fn();
    // Prisma queries are lazy thenables that execute on .then(). Start them here, inside the context, so a query
    // returned unawaited from `fn` still sees the tenant.
    if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
      return Promise.resolve(result) as T;
    }
    return result;
  });
}

export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export class TenantContextMissingError extends Error {
  readonly code = "TENANT_CONTEXT_MISSING";
  constructor(model: string, operation: string) {
    super(`No tenant context for ${model}.${operation}; tenant-scoped data needs runWithTenant()`);
  }
}

export class TenantMismatchError extends Error {
  readonly code = "TENANT_MISMATCH";
  constructor(model: string) {
    super(`${model}: tenantId in data does not match the request tenant`);
  }
}
