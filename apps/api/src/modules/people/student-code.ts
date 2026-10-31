import type { DbTransaction } from "@idrok/db";

/**
 * Next student code for the tenant ("STD-0001", Q-42). Serialised per tenant with a transaction-level advisory lock, so
 * parallel creations (e.g. an Excel import) never get the same number.
 */
export async function nextStudentCode(tx: DbTransaction, tenantId: string, prefix: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`student-code:${tenantId}`}, 0))`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("studentCode" FROM ${`^${prefix}-(\\d+)$`}) AS INTEGER)) AS max
    FROM "Student" WHERE "tenantId" = ${tenantId}::uuid AND "studentCode" ~ ${`^${prefix}-\\d+$`}`;
  const next = (rows[0]?.max ?? 0) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}
