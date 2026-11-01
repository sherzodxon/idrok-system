// Login accounts for profiles (Q-26, Q-27): students → username = student code, guardians → E.164 phone,
// employees → name-based. The temporary password is returned once and must be changed at first login.
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type { ListQuery, SystemRoleCode } from "@idrok/shared";
import { AppError, notFound } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import type { AuthStateStore } from "../access/auth-state";
import { writeAudit } from "../audit/audit.service";
import { generateTemporaryPassword, hashPassword } from "../auth/password";

/** Who creates accounts: a request user, or the user who started an import. */
export interface Actor {
  userId: string;
  roles: readonly string[];
}

export interface AccountCreated {
  userId: string;
  username: string;
  temporaryPassword: string;
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[ʻʼ'‘’`]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** What account changes need from the auth cache: revoking sessions and dropping cached state. */
export type AuthStateSink = Pick<AuthStateStore, "markRevoked" | "invalidate">;

export class AccountsService {
  constructor(
    private readonly db: Db,
    private readonly authState: AuthStateSink,
  ) {}

  private async roleIds(tx: DbTransaction, codes: SystemRoleCode[]) {
    const roles = await tx.role.findMany({
      where: { code: { in: codes }, archivedAt: null },
      select: { id: true, code: true },
    });
    if (roles.length !== codes.length) throw new AppError("CONFLICT", 409, { reason: "SYSTEM_ROLE_MISSING" });
    return roles.map((r) => r.id);
  }

  private async createUser(tx: DbTransaction, actor: Actor, username: string, roleIds: string[], phone?: string) {
    const taken = await tx.user.findFirst({ where: { username }, select: { id: true } });
    if (taken) throw new AppError("CONFLICT", 409, { reason: "USERNAME_TAKEN", username });
    const temporaryPassword = generateTemporaryPassword();
    const tenantId = requireTenantId();
    const user = await tx.user.create({
      data: {
        tenantId,
        username,
        phone: phone ?? null,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        createdById: actor.userId,
      },
    });
    if (roleIds.length) {
      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({ tenantId, userId: user.id, roleId, assignedById: actor.userId })),
      });
    }
    return { userId: user.id, username, temporaryPassword };
  }

  /** Runs inside the caller's transaction when one is given (import rows stay atomic). */
  private run<T>(tx: DbTransaction | undefined, fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.$transaction(fn);
  }

  async createStudentAccount(
    actor: Actor,
    studentId: string,
    allowBelowMinGrade = false,
    outer?: DbTransaction,
  ): Promise<AccountCreated> {
    return this.run(outer, async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: {
          studentCode: true,
          userId: true,
          enrollments: {
            where: { status: "ACTIVE" },
            select: { classGroup: { select: { grade: { select: { level: true } } } } },
          },
        },
      });
      if (!student) throw notFound();
      if (student.userId) throw new AppError("CONFLICT", 409, { reason: "ACCOUNT_EXISTS" });
      const settings = await tx.schoolSettings.findFirst({ select: { studentAccountMinGrade: true } });
      const minGrade = settings?.studentAccountMinGrade ?? 5;
      const level = student.enrollments[0]?.classGroup.grade.level;
      if ((level === undefined || level < minGrade) && !allowBelowMinGrade) {
        throw new AppError("CONFLICT", 409, { reason: "STUDENT_BELOW_MIN_GRADE", minGrade, level: level ?? null });
      }
      const account = await this.createUser(
        tx,
        actor,
        student.studentCode.toLowerCase(),
        await this.roleIds(tx, ["STUDENT"]),
      );
      await tx.student.update({ where: { id: studentId }, data: { userId: account.userId } });
      await writeAudit(tx, {
        action: "user.create",
        entityType: "User",
        entityId: account.userId,
        after: { studentId, username: account.username },
      });
      return account;
    });
  }

  async createGuardianAccount(actor: Actor, guardianId: string, outer?: DbTransaction): Promise<AccountCreated> {
    return this.run(outer, async (tx) => {
      const guardian = await tx.guardian.findUnique({
        where: { id: guardianId },
        select: { phone: true, userId: true },
      });
      if (!guardian) throw notFound();
      if (guardian.userId) throw new AppError("CONFLICT", 409, { reason: "ACCOUNT_EXISTS" });
      const account = await this.createUser(
        tx,
        actor,
        guardian.phone,
        await this.roleIds(tx, ["GUARDIAN"]),
        guardian.phone,
      );
      await tx.guardian.update({ where: { id: guardianId }, data: { userId: account.userId } });
      await writeAudit(tx, {
        action: "user.create",
        entityType: "User",
        entityId: account.userId,
        after: { guardianId, username: account.username },
      });
      return account;
    });
  }

  async createEmployeeAccount(
    actor: Actor,
    employeeId: string,
    roleIds?: string[],
    outer?: DbTransaction,
  ): Promise<AccountCreated> {
    return this.run(outer, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employee) throw notFound();
      if (employee.userId) throw new AppError("CONFLICT", 409, { reason: "ACCOUNT_EXISTS" });
      const ids = roleIds?.length ? roleIds : await this.roleIds(tx, ["TEACHER"]);
      const roles = await tx.role.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { code: true } });
      if (roles.length !== ids.length)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "roleIds", code: "unknown_role" }] });
      if (roles.some((r) => r.code === "SUPER_ADMIN") && !actor.roles.includes("SUPER_ADMIN")) {
        throw new AppError("FORBIDDEN", 403, { reason: "SUPER_ADMIN_ONLY" });
      }
      // firstname.lastname, then a numeric suffix if taken.
      const base = `${slug(employee.firstName)}.${slug(employee.lastName)}`.replace(/^\.|\.$/g, "") || "xodim";
      let username = base;
      for (let n = 2; await tx.user.findFirst({ where: { username }, select: { id: true } }); n++)
        username = `${base}${n}`;
      const account = await this.createUser(tx, actor, username, ids, employee.phone ?? undefined);
      await tx.employee.update({ where: { id: employeeId }, data: { userId: account.userId } });
      await writeAudit(tx, {
        action: "user.create",
        entityType: "User",
        entityId: account.userId,
        after: { employeeId, username },
      });
      return account;
    });
  }

  async resetPassword(userId: string): Promise<AccountCreated> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const result = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { username: true } });
      if (!user) throw notFound();
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true, authVersion: { increment: 1 } },
      });
      const sessions = await tx.authSession.updateManyAndReturn({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "ADMIN_PASSWORD_RESET" },
        select: { id: true },
      });
      await writeAudit(tx, { action: "user.password_reset", entityType: "User", entityId: userId });
      return { username: user.username, sessions };
    });
    await this.authState.markRevoked(result.sessions.map((s) => s.id));
    await this.authState.invalidate([userId]);
    return { userId, username: result.username, temporaryPassword };
  }

  async setStatus(actor: Actor, userId: string, status: "ACTIVE" | "DISABLED") {
    if (userId === actor.userId && status === "DISABLED")
      throw new AppError("CONFLICT", 409, { reason: "CANNOT_DISABLE_SELF" });
    const sessions = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!user) throw notFound();
      await tx.user.update({ where: { id: userId }, data: { status, authVersion: { increment: 1 } } });
      const revoked =
        status === "DISABLED"
          ? await tx.authSession.updateManyAndReturn({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date(), revokeReason: "ADMIN_DISABLED" },
              select: { id: true },
            })
          : [];
      await writeAudit(tx, {
        action: "user.status",
        entityType: "User",
        entityId: userId,
        before: { status: user.status },
        after: { status },
      });
      return revoked;
    });
    await this.authState.markRevoked(sessions.map((s) => s.id));
    await this.authState.invalidate([userId]);
    return { id: userId, status };
  }

  async list(q: ListQuery & { roleCode?: string; status?: "ACTIVE" | "DISABLED" }) {
    const search = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      AND: [
        q.status ? { status: q.status } : {},
        q.roleCode ? { roles: { some: { revokedAt: null, role: { code: q.roleCode } } } } : {},
        search ? { username: { contains: search, mode: "insensitive" } } : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: { username: "asc" },
        select: {
          id: true,
          username: true,
          status: true,
          mustChangePassword: true,
          lastLoginAt: true,
          roles: { where: { revokedAt: null }, select: { role: { select: { code: true } } } },
          student: { select: { id: true } },
          guardian: { select: { id: true } },
          employee: { select: { id: true } },
        },
        ...skipTake(q),
      }),
      this.db.user.count({ where }),
    ]);
    return page(
      items.map((u) => ({
        id: u.id,
        username: u.username,
        status: u.status,
        mustChangePassword: u.mustChangePassword,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        roles: u.roles.map((r) => r.role.code).sort(),
        profile: u.student ? "STUDENT" : u.guardian ? "GUARDIAN" : u.employee ? "EMPLOYEE" : null,
      })),
      total,
      q,
    );
  }
}
