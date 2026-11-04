// Login accounts for profiles (Q-26, Q-27): students → username = student code, guardians → E.164 phone,
// employees → name-based. The temporary password is returned once and must be changed at first login.
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type { ListQuery, SystemRoleCode, UserDetailDto } from "@idrok/shared";
import { D } from "@idrok/shared/decimal";
import { addSchoolDays, schoolDateToDb } from "@idrok/shared/time";
import { schoolClock } from "../access/school-clock";
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

  // ---------------------------------------------------------------- one account

  /** Revokes every open session of a user (logout everywhere); returns how many were open. */
  private async revokeAll(tx: DbTransaction, userId: string, reason: string) {
    return tx.authSession.updateManyAndReturn({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
      select: { id: true },
    });
  }

  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    const sessions = await this.db.$transaction(async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound();
      const revoked = await this.revokeAll(tx, userId, "ADMIN_LOGOUT_ALL");
      await writeAudit(tx, {
        action: "user.sessions_revoked",
        entityType: "User",
        entityId: userId,
        after: { count: revoked.length },
      });
      return revoked;
    });
    await this.authState.markRevoked(sessions.map((x) => x.id));
    await this.authState.invalidate([userId]);
    return { revoked: sessions.length };
  }

  /**
   * A new login name. Guardians log in with their phone (changed on the guardian card). The user signs in again
   * with the new name: open sessions are closed.
   */
  async changeUsername(userId: string, username: string): Promise<{ id: string; username: string }> {
    const sessions = await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { username: true, guardian: { select: { id: true } } },
      });
      if (!user) throw notFound();
      if (user.guardian) throw new AppError("CONFLICT", 409, { reason: "GUARDIAN_LOGIN_IS_PHONE" });
      if (user.username === username) return [];
      const taken = await tx.user.findFirst({ where: { username, id: { not: userId } }, select: { id: true } });
      if (taken) throw new AppError("CONFLICT", 409, { reason: "USERNAME_TAKEN", username });
      await tx.user.update({ where: { id: userId }, data: { username, authVersion: { increment: 1 } } });
      const revoked = await this.revokeAll(tx, userId, "USERNAME_CHANGED");
      await writeAudit(tx, {
        action: "user.username_change",
        entityType: "User",
        entityId: userId,
        before: { username: user.username },
        after: { username },
      });
      return revoked;
    });
    await this.authState.markRevoked(sessions.map((x) => x.id));
    await this.authState.invalidate([userId]);
    return { id: userId, username };
  }

  /**
   * Gives a system account (no card, e.g. the seed admin) an employee card: an existing one without a login, or a
   * new one. The card's name becomes the account's name and is edited on the card.
   */
  async linkEmployee(
    userId: string,
    input: { employeeId?: string; newEmployee?: { firstName: string; lastName: string } },
  ) {
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          phone: true,
          student: { select: { id: true } },
          guardian: { select: { id: true } },
          employee: { select: { id: true } },
        },
      });
      if (!user) throw notFound();
      if (user.student || user.guardian || user.employee)
        throw new AppError("CONFLICT", 409, { reason: "ACCOUNT_HAS_PERSON" });
      let employeeId = input.employeeId;
      if (employeeId) {
        const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
        if (!e) throw notFound();
        if (e.userId) throw new AppError("CONFLICT", 409, { reason: "ACCOUNT_EXISTS" });
        await tx.employee.update({ where: { id: employeeId }, data: { userId } });
      } else {
        const e = await tx.employee.create({
          data: { tenantId: requireTenantId(), ...input.newEmployee!, phone: user.phone, userId },
        });
        employeeId = e.id;
      }
      await writeAudit(tx, {
        action: "user.link_employee",
        entityType: "User",
        entityId: userId,
        after: { employeeId },
      });
    });
    return this.detail(userId);
  }

  async detail(userId: string): Promise<UserDetailDto> {
    const u = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        status: true,
        mustChangePassword: true,
        createdAt: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        roles: { where: { revokedAt: null }, select: { role: { select: { id: true, code: true, name: true } } } },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { lastUsedAt: "desc" },
          select: { id: true, clientType: true, userAgent: true, createdAt: true, lastUsedAt: true },
        },
        employee: { select: { id: true, firstName: true, lastName: true, positionTitle: true } },
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            studentCode: true,
            coinAccount: { select: { balance: true } },
          },
        },
        guardian: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            students: {
              where: { revokedAt: null },
              select: { student: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
        },
      },
    });
    if (!u) throw notFound();
    const { today } = await schoolClock(this.db);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const fromDate = schoolDateToDb(addSchoolDays(today, -29));
    const auditActions = await this.db.auditLog.count({ where: { actorUserId: userId, createdAt: { gte: since } } });

    let employee: UserDetailDto["stats"]["employee"] = null;
    if (u.employee) {
      const teacherId = u.employee.id;
      const [scoresGiven, coinEvaluations, testsTotal, questionsTotal, groups] = await Promise.all([
        this.db.scoreEntry.count({ where: { teacherId, reversesEntryId: null, createdAt: { gte: since } } }),
        this.db.coinTransaction.count({
          where: { teacherId, type: { in: ["REWARD", "PENALTY"] }, createdAt: { gte: since } },
        }),
        this.db.test.count({ where: { teacherId } }),
        this.db.question.count({ where: { ownerId: teacherId } }),
        this.db.teacherAssignment.findMany({
          where: {
            teacherId,
            validFrom: { lte: schoolDateToDb(today) },
            OR: [{ validTo: null }, { validTo: { gte: schoolDateToDb(today) } }],
          },
          distinct: ["teachingGroupId"],
          select: { teachingGroupId: true },
        }),
      ]);
      employee = { scoresGiven, coinEvaluations, testsTotal, questionsTotal, teachingGroups: groups.length };
    }

    let student: UserDetailDto["stats"]["student"] = null;
    if (u.student) {
      const studentId = u.student.id;
      const [attempts, records] = await Promise.all([
        this.db.testAttempt.findMany({
          where: { studentId, status: "FINISHED", finishedAt: { gte: since } },
          select: { percent: true },
        }),
        this.db.attendanceRecord.findMany({
          where: { studentId, schoolDate: { gte: fromDate } },
          select: { deviceStatus: true, manualStatus: true },
        }),
      ]);
      const scored = attempts.filter((a) => a.percent !== null);
      const attendance: Record<string, number> = {};
      for (const r of records) {
        const k = r.manualStatus ?? r.deviceStatus ?? "UNKNOWN";
        attendance[k] = (attendance[k] ?? 0) + 1;
      }
      student = {
        testsFinished: attempts.length,
        averagePercent: scored.length
          ? scored
              .reduce((sum, a) => sum.plus(D(a.percent!.toString())), D(0))
              .div(scored.length)
              .toDecimalPlaces(1)
              .toString()
          : null,
        coinBalance: u.student.coinAccount?.balance ?? 0,
        attendance,
      };
    }

    const guardian = u.guardian
      ? {
          children: u.guardian.students.map((s) => ({
            id: s.student.id,
            name: `${s.student.lastName} ${s.student.firstName}`,
          })),
        }
      : null;

    const person = u.employee
      ? { kind: "EMPLOYEE" as const, ...u.employee, detail: u.employee.positionTitle }
      : u.student
        ? {
            kind: "STUDENT" as const,
            id: u.student.id,
            firstName: u.student.firstName,
            lastName: u.student.lastName,
            detail: u.student.studentCode,
          }
        : u.guardian
          ? {
              kind: "GUARDIAN" as const,
              id: u.guardian.id,
              firstName: u.guardian.firstName,
              lastName: u.guardian.lastName,
              detail: u.guardian.phone,
            }
          : null;
    return {
      id: u.id,
      username: u.username,
      displayName: person ? `${person.firstName} ${person.lastName}` : u.username,
      status: u.status,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
      roles: u.roles.map((r) => r.role).sort((a, b) => a.code.localeCompare(b.code)),
      person: person
        ? {
            kind: person.kind,
            id: person.id,
            firstName: person.firstName,
            lastName: person.lastName,
            detail: person.detail,
          }
        : null,
      sessions: u.sessions.map((x) => ({
        id: x.id,
        clientType: x.clientType,
        userAgent: x.userAgent,
        createdAt: x.createdAt.toISOString(),
        lastUsedAt: x.lastUsedAt.toISOString(),
      })),
      stats: { auditActions, employee, student, guardian },
    };
  }

  async list(q: ListQuery & { roleCode?: string; status?: "ACTIVE" | "DISABLED" }) {
    const search = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      AND: [
        q.status ? { status: q.status } : {},
        q.roleCode ? { roles: { some: { revokedAt: null, role: { code: q.roleCode } } } } : {},
        search
          ? {
              OR: [
                { username: { contains: search, mode: "insensitive" } },
                ...(["employee", "student", "guardian"] as const).flatMap((card) =>
                  (["firstName", "lastName"] as const).map((f) => ({
                    [card]: { [f]: { contains: search, mode: "insensitive" } },
                  })),
                ),
              ],
            }
          : {},
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
          student: { select: { id: true, firstName: true, lastName: true } },
          guardian: { select: { id: true, firstName: true, lastName: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
        ...skipTake(q),
      }),
      this.db.user.count({ where }),
    ]);
    return page(
      items.map((u) => ({
        id: u.id,
        username: u.username,
        name: ((p) => (p ? `${p.lastName} ${p.firstName}` : null))(u.employee ?? u.student ?? u.guardian),
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
