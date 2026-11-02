// Test types (tests.md §1): an admin-managed list. The system types are created the first time the list is read.
import type { z } from "zod";
import { requireTenantId, type Db } from "@idrok/db";
import type { CreateTestTypeSchema, TestTypeDto, UpdateTestTypeSchema } from "@idrok/shared";
import { AppError, notFound, isConstraintError } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";

/** code → default name; the UI shows system types by their code's translation. */
export const SYSTEM_TEST_TYPES = [
  ["CHSB", "ChSB"],
  ["BSB", "BSB"],
  ["CONTROL_WORK", "Nazorat ishi"],
  ["TRIAL", "Sinov testi"],
  ["REGULAR", "Oddiy test"],
] as const;

const dto = (t: { id: string; name: string; code: string; isSystem: boolean; isActive: boolean }): TestTypeDto => ({
  id: t.id,
  name: t.name,
  code: t.code,
  isSystem: t.isSystem,
  isActive: t.isActive,
});

export class TestTypesService {
  constructor(private readonly db: Db) {}

  async ensureSystem() {
    const existing = await this.db.testType.findMany({ where: { isSystem: true }, select: { code: true } });
    const missing = SYSTEM_TEST_TYPES.filter(([code]) => !existing.some((e) => e.code === code));
    if (missing.length)
      await this.db.testType.createMany({
        data: missing.map(([code, name]) => ({ tenantId: requireTenantId(), code, name, isSystem: true })),
        skipDuplicates: true,
      });
  }

  async list(includeInactive: boolean) {
    await this.ensureSystem();
    const rows = await this.db.testType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return rows.map(dto);
  }

  async create(input: z.infer<typeof CreateTestTypeSchema>) {
    try {
      return await this.db.$transaction(async (tx) => {
        const t = await tx.testType.create({ data: { tenantId: requireTenantId(), ...input } });
        await writeAudit(tx, { action: "test_type.create", entityType: "TestType", entityId: t.id, after: input });
        return dto(t);
      });
    } catch (err) {
      if (isConstraintError(err, "TestType_tenantId_code_key"))
        throw new AppError("CONFLICT", 409, { reason: "TEST_TYPE_CODE_TAKEN" });
      throw err;
    }
  }

  async update(id: string, input: z.infer<typeof UpdateTestTypeSchema>) {
    return this.db.$transaction(async (tx) => {
      const found = await tx.testType.findFirst({ where: { id } });
      if (!found) throw notFound();
      const t = await tx.testType.update({ where: { id }, data: input });
      await writeAudit(tx, { action: "test_type.update", entityType: "TestType", entityId: id, after: input });
      return dto(t);
    });
  }
}
