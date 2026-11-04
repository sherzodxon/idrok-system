import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import {
  accountWhere,
  cleanName,
  type CreateEmployeeSchema,
  type EmployeeDto,
  type ListQuery,
  type UpdateEmployeeSchema,
} from "@idrok/shared";
import type { z } from "zod";
import { notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import { writeAudit } from "../audit/audit.service";
import { normalizePhoneOrThrow } from "./students.service";

const toDto = (e: Prisma.EmployeeGetPayload<object>): EmployeeDto => ({
  id: e.id,
  employeeCode: e.employeeCode,
  firstName: e.firstName,
  lastName: e.lastName,
  middleName: e.middleName,
  phone: e.phone,
  positionTitle: e.positionTitle,
  status: e.status,
  hasAccount: !!e.userId,
});

export class EmployeesService {
  constructor(private readonly db: Db) {}

  async list(q: ListQuery & { status?: "ACTIVE" | "ON_LEAVE" | "LEFT"; account?: "with" | "without" }) {
    const search = q.q?.trim();
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        q.status ? { status: q.status } : {},
        accountWhere(q.account),
        search
          ? {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                { employeeCode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.employee.findMany({
        where,
        orderBy: orderBy(q.sort, ["lastName", "firstName", "createdAt"] as const, [
          { lastName: "asc" },
          { firstName: "asc" },
        ]),
        ...skipTake(q),
      }),
      this.db.employee.count({ where }),
    ]);
    return page(items.map(toDto), total, q);
  }

  async get(id: string) {
    const e = await this.db.employee.findUnique({ where: { id } });
    if (!e) throw notFound();
    return toDto(e);
  }

  async create(input: z.infer<typeof CreateEmployeeSchema>) {
    return this.db.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          tenantId: requireTenantId(),
          firstName: cleanName(input.firstName),
          lastName: cleanName(input.lastName),
          middleName: input.middleName ? cleanName(input.middleName) : null,
          phone: input.phone ? normalizePhoneOrThrow(input.phone, "phone") : null,
          positionTitle: input.positionTitle ?? null,
          employeeCode: input.employeeCode ?? null,
        },
      });
      await writeAudit(tx, { action: "employee.create", entityType: "Employee", entityId: e.id });
      return toDto(e);
    });
  }

  async update(id: string, input: z.infer<typeof UpdateEmployeeSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.employee.findUnique({ where: { id } });
      if (!before) throw notFound();
      const e = await tx.employee.update({
        where: { id },
        data: {
          ...(input.firstName !== undefined ? { firstName: cleanName(input.firstName) } : {}),
          ...(input.lastName !== undefined ? { lastName: cleanName(input.lastName) } : {}),
          ...(input.middleName !== undefined
            ? { middleName: input.middleName ? cleanName(input.middleName) : null }
            : {}),
          ...(input.phone !== undefined
            ? { phone: input.phone ? normalizePhoneOrThrow(input.phone, "phone") : null }
            : {}),
          ...(input.positionTitle !== undefined ? { positionTitle: input.positionTitle } : {}),
          ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await writeAudit(tx, { action: "employee.update", entityType: "Employee", entityId: id, before, after: input });
      return toDto(e);
    });
  }
}
