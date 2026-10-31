// Transactional outbox relay: events written with the business change are handed to BullMQ here, so a committed
// change can never lose its job (architecture.md §8). Job ids = event ids, so a re-relayed event is not duplicated.
import type { Prisma, RootClient } from "@idrok/db";
import { EVENT_ROUTES, type Queues } from "./queue";

const MAX_ATTEMPTS = 10;

export async function relayOutbox(root: RootClient, queues: Queues, batchSize = 50): Promise<number> {
  return root.$transaction(async (tx) => {
    const events = await tx.$queryRaw<{ id: string; type: string; payload: Prisma.JsonValue; attempts: number }[]>`
      SELECT "id", "type", "payload", "attempts" FROM "OutboxEvent"
      WHERE "status" = 'PENDING' AND "availableAt" <= now()
      ORDER BY "createdAt" LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    for (const e of events) {
      const route = EVENT_ROUTES[e.type];
      try {
        if (route) await queues[route.queue].add(route.name, e.payload, { jobId: e.id });
        await tx.outboxEvent.update({ where: { id: e.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      } catch (err) {
        const attempts = e.attempts + 1;
        await tx.outboxEvent.update({
          where: { id: e.id },
          data: {
            attempts,
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** attempts)),
            lastError: err instanceof Error ? err.message.slice(0, 500) : "unknown",
          },
        });
      }
    }
    return events.length;
  });
}
