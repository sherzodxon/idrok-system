import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import {
  cleanName,
  type CreateGuardianSchema,
  type GuardianDto,
  type ListQuery,
  type UpdateGuardianSchema,
} from "@idrok/shared";
import type { z } from "zod";
import type { RequestAuth } from "../../http/auth";
import { notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import { guardianWhere, resolveScope } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { normalizePhoneOrThrow } from "./students.service";

const select = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  phone: true,
  notes: true,
  userId: true,
  students: {
    where: { revokedAt: null },
    select: { relation: true, student: { select: { id: true, firstName: true, lastName: true } } },
  },
} satisfies Prisma.GuardianSelect;

const toDto = (g: Prisma.GuardianGetPayload<{ select: typeof select }>): GuardianDto => ({
  id: g.id,
  firstName: g.firstName,
  lastName: g.lastName,
  middleName: g.middleName,
  phone: g.phone,
  notes: g.notes,
  hasAccount: !!g.userId,
  children: g.students.map((s) => ({
    studentId: s.student.id,
    firstName: s.student.firstName,
    lastName: s.student.lastName,
    relation: s.relation,
  })),
});

export class GuardiansService {
  constructor(private readonly db: Db) {}

  private async scopeWhere(auth: RequestAuth) {
    const { timezone } = await schoolClock(this.db);
    return guardianWhere(await resolveScope(this.db, auth, timezone));
  }

  async list(auth: RequestAuth, q: ListQuery) {
    const search = q.q?.trim();
    const digits = search?.replace(/\D/g, "");
    const where: Prisma.GuardianWhereInput = {
      AND: [
        await this.scopeWhere(auth),
        search
          ? {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.guardian.findMany({
        where,
        select,
        orderBy: orderBy(q.sort, ["lastName", "firstName", "createdAt"] as const, [
          { lastName: "asc" },
          { firstName: "asc" },
        ]),
        ...skipTake(q),
      }),
      this.db.guardian.count({ where }),
    ]);
    return page(items.map(toDto), total, q);
  }

  async get(auth: RequestAuth, id: string) {
    const g = await this.db.guardian.findFirst({ where: { AND: [{ id }, await this.scopeWhere(auth)] }, select });
    if (!g) throw notFound();
    return toDto(g);
  }

  async create(input: z.infer<typeof CreateGuardianSchema>) {
    return this.db.$transaction(async (tx) => {
      const g = await tx.guardian.create({
        data: {
          tenantId: requireTenantId(),
          firstName: cleanName(input.firstName),
          lastName: cleanName(input.lastName),
          middleName: input.middleName ? cleanName(input.middleName) : null,
          phone: normalizePhoneOrThrow(input.phone, "phone"),
          notes: input.notes ?? null,
        },
        select,
      });
      await writeAudit(tx, { action: "guardian.create", entityType: "Guardian", entityId: g.id });
      return toDto(g);
    });
  }

  async update(id: string, input: z.infer<typeof UpdateGuardianSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.guardian.findUnique({ where: { id } });
      if (!before) throw notFound();
      const g = await tx.guardian.update({
        where: { id },
        data: {
          ...(input.firstName !== undefined ? { firstName: cleanName(input.firstName) } : {}),
          ...(input.lastName !== undefined ? { lastName: cleanName(input.lastName) } : {}),
          ...(input.middleName !== undefined
            ? { middleName: input.middleName ? cleanName(input.middleName) : null }
            : {}),
          ...(input.phone !== undefined ? { phone: normalizePhoneOrThrow(input.phone, "phone") } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        select,
      });
      await writeAudit(tx, { action: "guardian.update", entityType: "Guardian", entityId: id, before, after: input });
      return toDto(g);
    });
  }
}
