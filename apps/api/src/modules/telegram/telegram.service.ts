// Admin side of M7: guardians' link status, broadcasts to classes (T-96). Codes and unlinking live in the linking
// service. Everything here runs on the tenant-scoped client.
import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type { BroadcastDto, BroadcastPreviewDto, ListQuery, TelegramGuardianDto, TelegramLinkStatus } from "@idrok/shared";
import { AppError } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { deferForQuietHours } from "../../domain/notifications";
import { enqueueNotifications } from "../notifications/fanout";
import { notificationSettings } from "../notifications/settings";

const activeLink = { revokedAt: null } satisfies Prisma.TelegramLinkWhereInput;

function statusWhere(status: TelegramLinkStatus): Prisma.GuardianWhereInput {
  if (status === "LINKED") return { telegramLinks: { some: { ...activeLink, blockedAt: null } } };
  if (status === "BLOCKED") return { telegramLinks: { some: { ...activeLink, blockedAt: { not: null } } } };
  return { telegramLinks: { none: activeLink } };
}

export class TelegramAdminService {
  constructor(private readonly db: Db) {}

  async summary() {
    const [guardians, linked, blocked] = await Promise.all([
      this.db.guardian.count({ where: { students: { some: { revokedAt: null } } } }),
      this.db.telegramLink.count({ where: { ...activeLink, blockedAt: null } }),
      this.db.telegramLink.count({ where: { ...activeLink, blockedAt: { not: null } } }),
    ]);
    return { guardians, linked, blocked };
  }

  async guardians(q: ListQuery & { status?: TelegramLinkStatus; classGroupId?: string }) {
    const search = q.q?.trim();
    const digits = search?.replace(/\D/g, "");
    const and: Prisma.GuardianWhereInput[] = [{ students: { some: { revokedAt: null } } }];
    if (search)
      and.push({
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      });
    if (q.status) and.push(statusWhere(q.status));
    if (q.classGroupId)
      and.push({
        students: {
          some: {
            revokedAt: null,
            student: { enrollments: { some: { classGroupId: q.classGroupId, status: "ACTIVE" } } },
          },
        },
      });
    const where: Prisma.GuardianWhereInput = { AND: and };
    const now = new Date();
    const [total, rows] = await Promise.all([
      this.db.guardian.count({ where }),
      this.db.guardian.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        ...skipTake(q),
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          students: {
            where: { revokedAt: null },
            select: {
              student: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  enrollments: {
                    where: { status: "ACTIVE" },
                    select: { classGroup: { select: { name: true } } },
                    take: 1,
                  },
                },
              },
            },
          },
          telegramLinks: {
            where: activeLink,
            select: { linkedAt: true, method: true, username: true, blockedAt: true },
          },
          telegramLinkCodes: {
            where: { usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
            select: { expiresAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          notifications: {
            where: { status: "SENT" },
            select: { sentAt: true },
            orderBy: { sentAt: "desc" },
            take: 1,
          },
        },
      }),
    ]);
    const items: TelegramGuardianDto[] = rows.map((g) => {
      const link = g.telegramLinks[0];
      return {
        guardianId: g.id,
        fullName: `${g.lastName} ${g.firstName}`,
        phone: g.phone,
        children: g.students.map(({ student: s }) => ({
          id: s.id,
          fullName: `${s.lastName} ${s.firstName}`,
          classGroup: s.enrollments[0]?.classGroup.name ?? null,
        })),
        status: !link ? "NOT_LINKED" : link.blockedAt ? "BLOCKED" : "LINKED",
        linkedAt: link?.linkedAt.toISOString() ?? null,
        method: (link?.method as "CONTACT" | "CODE" | undefined) ?? null,
        telegramUsername: link?.username ?? null,
        lastSentAt: g.notifications[0]?.sentAt?.toISOString() ?? null,
        pendingCodeExpiresAt: g.telegramLinkCodes[0]?.expiresAt.toISOString() ?? null,
      };
    });
    return page(items, total, q);
  }

  /** Guardians of the active students of these classes who want notifications and may see the data. */
  private async audience(classGroupIds: string[]) {
    const found = await this.db.classGroup.count({ where: { id: { in: classGroupIds } } });
    if (found !== new Set(classGroupIds).size)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "classGroupIds", code: "unknown" }] });
    const students = await this.db.studentEnrollment.findMany({
      where: { classGroupId: { in: classGroupIds }, status: "ACTIVE", student: { status: "ACTIVE" } },
      distinct: ["studentId"],
      select: { studentId: true },
    });
    const links = await this.db.studentGuardian.findMany({
      where: {
        studentId: { in: students.map((s) => s.studentId) },
        revokedAt: null,
        receivesNotifications: true,
        canViewData: true,
      },
      distinct: ["guardianId"],
      select: {
        guardianId: true,
        guardian: {
          select: {
            notificationPreference: { select: { quietStartMinute: true, quietEndMinute: true, quietHoursOff: true } },
            telegramLinks: { where: { ...activeLink, blockedAt: null }, select: { id: true } },
          },
        },
      },
    });
    return { students: students.length, guardians: links };
  }

  async preview(classGroupIds: string[]): Promise<BroadcastPreviewDto> {
    const { students, guardians } = await this.audience(classGroupIds);
    return {
      students,
      guardians: guardians.length,
      reachable: guardians.filter((g) => g.guardian.telegramLinks.length).length,
    };
  }

  async create(input: { classGroupIds: string[]; text: string }, actorUserId: string): Promise<BroadcastDto> {
    const [{ guardians }, settings, { timezone }, branding] = await Promise.all([
      this.audience(input.classGroupIds),
      notificationSettings(this.db),
      schoolClock(this.db),
      this.db.schoolBranding.findFirst({ select: { schoolName: true } }),
    ]);
    const now = new Date();
    const school = { startMinute: settings.quietStartMinute, endMinute: settings.quietEndMinute };
    const recipients = guardians.filter((g) => g.guardian.telegramLinks.length || settings.smsFallbackEnabled);
    const id = await this.db.$transaction(async (tx) => {
      const broadcast = await tx.broadcast.create({
        data: {
          tenantId: requireTenantId(),
          text: input.text,
          classGroupIds: [...new Set(input.classGroupIds)],
          recipientCount: recipients.length,
          createdById: actorUserId,
        },
        select: { id: true },
      });
      await enqueueNotifications(
        tx,
        recipients.map((g) => {
          const own = g.guardian.notificationPreference;
          const quiet = own?.quietHoursOff
            ? null
            : own && own.quietStartMinute !== null && own.quietEndMinute !== null
              ? { startMinute: own.quietStartMinute, endMinute: own.quietEndMinute }
              : school;
          return {
            guardianId: g.guardianId,
            kind: "BROADCAST" as const,
            dedupeKey: `broadcast:${broadcast.id}`,
            params: { school: branding?.schoolName ?? "", text: input.text },
            broadcastId: broadcast.id,
            scheduledAt: deferForQuietHours(now, quiet, timezone),
          };
        }),
      );
      await writeAudit(tx, {
        action: "notifications.broadcast",
        entityType: "Broadcast",
        entityId: broadcast.id,
        after: { classGroupIds: input.classGroupIds, recipients: recipients.length, length: input.text.length },
      });
      return broadcast.id;
    });
    const [created] = (await this.broadcasts({ page: 1, pageSize: 1 }, id)).items;
    return created!;
  }

  async broadcasts(q: ListQuery, onlyId?: string) {
    const where: Prisma.BroadcastWhereInput = onlyId ? { id: onlyId } : {};
    const [total, rows] = await Promise.all([
      this.db.broadcast.count({ where }),
      this.db.broadcast.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q) }),
    ]);
    const ids = rows.map((r) => r.id);
    const [counts, classes, users] = await Promise.all([
      this.db.notification.groupBy({
        by: ["broadcastId", "status"],
        where: { broadcastId: { in: ids } },
        _count: { _all: true },
      }),
      this.db.classGroup.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => r.classGroupIds))] } },
        select: { id: true, name: true },
      }),
      this.db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
        select: { id: true, username: true, employee: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    const className = new Map(classes.map((c) => [c.id, c.name]));
    const userName = new Map(
      users.map((u) => [u.id, u.employee ? `${u.employee.lastName} ${u.employee.firstName}` : u.username]),
    );
    const count = (id: string, status: string) =>
      counts.find((c) => c.broadcastId === id && c.status === status)?._count._all ?? 0;
    const items: BroadcastDto[] = rows.map((r) => ({
      id: r.id,
      text: r.text,
      classGroups: r.classGroupIds.map((c) => className.get(c) ?? "").filter(Boolean),
      recipientCount: r.recipientCount,
      sent: count(r.id, "SENT"),
      pending: count(r.id, "PENDING"),
      failed: count(r.id, "FAILED"),
      skipped: count(r.id, "SKIPPED"),
      createdBy: userName.get(r.createdById) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return page(items, total, q);
  }
}
