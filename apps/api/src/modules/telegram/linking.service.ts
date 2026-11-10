// Linking a Telegram account to a guardian (T-91): the user's own contact matched to exactly one guardian phone, or
// a one-time code issued by an admin. One active link per guardian and per Telegram user; a new link replaces both
// old ones. Every link and unlink is audited in the same transaction; unlinking revokes the link's Mini App sessions.
import { currentTenantContext, requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import { normalizeUzPhone, type LinkCodeIssuedDto } from "@idrok/shared";
import { hashLinkCode, newLinkCode } from "../../domain/telegram";
import { AppError, notFound } from "../../http/errors";
import type { AuthStateSink } from "../users/accounts.service";
import { writeAudit } from "../audit/audit.service";
import { notificationSettings } from "../notifications/settings";

export interface TelegramIdentity {
  telegramUserId: bigint;
  chatId: bigint;
  username: string | null;
  languageCode: string | null;
}

export type LinkOutcome =
  | { kind: "LINKED"; guardianId: string; guardianName: string }
  | { kind: "NOT_FOUND" }
  | { kind: "AMBIGUOUS" }
  | { kind: "CODE_INVALID" };

const guardianName = (g: { firstName: string; lastName: string }) => `${g.lastName} ${g.firstName}`;

/** Revokes the sessions opened through these links (Mini App) and drops them from the auth cache. */
async function revokeLinkSessions(tx: DbTransaction, linkIds: string[]): Promise<string[]> {
  if (!linkIds.length) return [];
  const sessions = await tx.authSession.findMany({
    where: { telegramLinkId: { in: linkIds }, revokedAt: null },
    select: { id: true },
  });
  if (sessions.length)
    await tx.authSession.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { revokedAt: new Date(), revokeReason: "TELEGRAM_UNLINKED" },
    });
  return sessions.map((s) => s.id);
}

export class TelegramLinkingService {
  constructor(
    private readonly db: Db,
    private readonly authState: AuthStateSink,
  ) {}

  private async link(
    tx: DbTransaction,
    guardian: { id: string; firstName: string; lastName: string },
    who: TelegramIdentity,
    method: "CONTACT" | "CODE",
  ): Promise<{ outcome: LinkOutcome; revokedSessions: string[] }> {
    // Serialise links of this guardian and this Telegram user.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tg-link:${requireTenantId()}:${guardian.id}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tg-user:${requireTenantId()}:${who.telegramUserId}`}, 0))`;
    const current = await tx.telegramLink.findMany({
      where: { revokedAt: null, OR: [{ guardianId: guardian.id }, { telegramUserId: who.telegramUserId }] },
      select: { id: true, guardianId: true, telegramUserId: true },
    });
    const same = current.find((l) => l.guardianId === guardian.id && l.telegramUserId === who.telegramUserId);
    let revokedSessions: string[] = [];
    if (same) {
      // Linked again from the same account: refresh the chat and unblock (the user came back to the bot).
      await tx.telegramLink.update({
        where: { id: same.id },
        data: { chatId: who.chatId, username: who.username, languageCode: who.languageCode, blockedAt: null },
      });
    } else {
      const replaced = current.map((l) => l.id);
      if (replaced.length) {
        await tx.telegramLink.updateMany({
          where: { id: { in: replaced } },
          data: { revokedAt: new Date(), revokeReason: "REPLACED" },
        });
        revokedSessions = await revokeLinkSessions(tx, replaced);
      }
      const created = await tx.telegramLink.create({
        data: {
          guardianId: guardian.id,
          telegramUserId: who.telegramUserId,
          chatId: who.chatId,
          username: who.username,
          languageCode: who.languageCode,
          method,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actorUserId: null,
        action: "telegram.link",
        entityType: "TelegramLink",
        entityId: created.id,
        after: { guardianId: guardian.id, method, replaced: replaced.length },
      });
    }
    return {
      outcome: { kind: "LINKED", guardianId: guardian.id, guardianName: guardianName(guardian) },
      revokedSessions,
    };
  }

  private async finish(result: { outcome: LinkOutcome; revokedSessions: string[] }) {
    if (result.revokedSessions.length) await this.authState.markRevoked(result.revokedSessions);
    return result.outcome;
  }

  /** Contact share: the caller checked that the contact is the sender's own. */
  async linkByPhone(rawPhone: string, who: TelegramIdentity): Promise<LinkOutcome> {
    const phone = normalizeUzPhone(rawPhone);
    if (!phone) return { kind: "NOT_FOUND" };
    // Only guardians who still have a child linked (a guardian left over from an old record is no match).
    const matches = await this.db.guardian.findMany({
      where: { phone, students: { some: { revokedAt: null } } },
      select: { id: true, firstName: true, lastName: true },
      take: 2,
    });
    if (!matches.length) return { kind: "NOT_FOUND" };
    if (matches.length > 1) return { kind: "AMBIGUOUS" };
    return this.finish(await this.db.$transaction((tx) => this.link(tx, matches[0]!, who, "CONTACT")));
  }

  async linkByCode(code: string, who: TelegramIdentity, now = new Date()): Promise<LinkOutcome> {
    const result = await this.db.$transaction(async (tx) => {
      const rows = await tx.telegramLinkCode.findMany({
        where: { codeHash: hashLinkCode(code), usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
        select: { id: true, guardian: { select: { id: true, firstName: true, lastName: true } } },
      });
      const row = rows[0];
      if (!row) return { outcome: { kind: "CODE_INVALID" } as LinkOutcome, revokedSessions: [] };
      // Single use, even when two messages with the code race.
      const used = await tx.telegramLinkCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!used.count) return { outcome: { kind: "CODE_INVALID" } as LinkOutcome, revokedSessions: [] };
      return this.link(tx, row.guardian, who, "CODE");
    });
    return this.finish(result);
  }

  /** From the bot (/unlink): the Telegram user ends their own link. */
  async unlinkTelegramUser(telegramUserId: bigint): Promise<boolean> {
    const revoked = await this.db.$transaction(async (tx) => {
      const links = await tx.telegramLink.findMany({ where: { telegramUserId, revokedAt: null }, select: { id: true } });
      if (!links.length) return null;
      return this.revoke(tx, links.map((l) => l.id), "USER", null);
    });
    if (revoked) await this.authState.markRevoked(revoked);
    return revoked !== null;
  }

  /** Admin or the guardian themself. */
  async unlinkGuardian(guardianId: string, byUserId: string, reason: "ADMIN" | "GUARDIAN"): Promise<void> {
    const revoked = await this.db.$transaction(async (tx) => {
      const links = await tx.telegramLink.findMany({ where: { guardianId, revokedAt: null }, select: { id: true } });
      if (!links.length) throw notFound();
      return this.revoke(tx, links.map((l) => l.id), reason, byUserId);
    });
    await this.authState.markRevoked(revoked);
  }

  private async revoke(tx: DbTransaction, ids: string[], reason: string, byUserId: string | null) {
    await tx.telegramLink.updateMany({
      where: { id: { in: ids } },
      data: { revokedAt: new Date(), revokeReason: reason, revokedByUserId: byUserId },
    });
    const sessions = await revokeLinkSessions(tx, ids);
    for (const id of ids)
      await writeAudit(tx, {
        ...(byUserId ? {} : { actorUserId: null }),
        action: "telegram.unlink",
        entityType: "TelegramLink",
        entityId: id,
        after: { reason, sessionsRevoked: sessions.length },
      });
    return sessions;
  }

  /** A new one-time code; earlier unused codes of the guardian stop working. Shown once. */
  async issueCode(guardianId: string, botUsername: string | undefined, now = new Date()): Promise<LinkCodeIssuedDto> {
    return this.db.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({ where: { id: guardianId }, select: { id: true } });
      if (!guardian) throw notFound();
      const settings = await notificationSettings(tx);
      await tx.telegramLinkCode.updateMany({
        where: { guardianId, usedAt: null, cancelledAt: null },
        data: { cancelledAt: now },
      });
      const code = newLinkCode();
      const expiresAt = new Date(now.getTime() + settings.linkCodeTtlHours * 3_600_000);
      const row = await tx.telegramLinkCode.create({
        data: {
          guardianId,
          codeHash: hashLinkCode(code),
          expiresAt,
          createdById: requireUserId(),
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        action: "telegram.code.issue",
        entityType: "TelegramLinkCode",
        entityId: row.id,
        after: { guardianId, expiresAt: expiresAt.toISOString() },
      });
      return {
        code,
        deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }
}

/** Codes are issued by a logged-in admin; the tenant context carries their id. */
function requireUserId(): string {
  const id = currentTenantContext()?.userId;
  if (!id) throw new AppError("AUTH_REQUIRED", 401);
  return id;
}
