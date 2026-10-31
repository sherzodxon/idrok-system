// Auth runs before a tenant context exists (login, refresh), so it uses the root client with explicit tenant filters.
import type { ClientType, Prisma, RootClient } from "@idrok/db";

type Tx = Prisma.TransactionClient;

export class AuthRepository {
  constructor(private readonly root: RootClient) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.root.$transaction(fn);
  }

  findTenantBySlug(slug: string) {
    return this.root.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
  }

  findUserForLogin(tenantId: string, usernames: string[]) {
    return this.root.user.findFirst({
      where: { tenantId, username: { in: usernames } },
      select: { id: true, tenantId: true, username: true, passwordHash: true, status: true },
    });
  }

  createSession(
    tx: Tx,
    data: {
      tenantId: string;
      userId: string;
      clientType: ClientType;
      refreshTokenHash: string;
      expiresAt: Date;
      userAgent?: string;
    },
  ) {
    return tx.authSession.create({ data, select: { id: true } });
  }

  /** Locks the session row that holds this refresh token (current or previous) for the rest of the transaction. */
  async lockSessionByTokenHash(tx: Tx, hash: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "AuthSession"
      WHERE "refreshTokenHash" = ${hash} OR "previousTokenHash" = ${hash}
      FOR UPDATE`;
    const id = rows[0]?.id;
    return id ? tx.authSession.findUnique({ where: { id } }) : null;
  }

  rotate(tx: Tx, sessionId: string, previousHash: string, nextHash: string, expiresAt: Date) {
    return tx.authSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: nextHash,
        previousTokenHash: previousHash,
        rotatedAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
  }

  touch(tx: Tx, sessionId: string) {
    return tx.authSession.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
  }

  revokeSessions(tx: Tx, where: Prisma.AuthSessionWhereInput, reason: string) {
    return tx.authSession.updateManyAndReturn({
      where: { ...where, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
      select: { id: true },
    });
  }

  markLogin(tx: Tx, userId: string) {
    return tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }
}
