// Background worker (apps/worker runs this): BullMQ processors, the outbox relay and maintenance.
// Every job runs inside the tenant context taken from its payload.
import { runWithTenant } from "@idrok/db";
import { Worker, type Job } from "bullmq";
import type { Logger } from "pino";
import { buildDeps, closeDeps } from "../bootstrap";
import type { Env } from "../config/env";
import type { AppDeps } from "../deps";
import { relayOutbox } from "../infra/outbox";
import { QUEUES, bullConnection, type ImportJobPayload, type TestJobPayload } from "../infra/queue";
import { awardTestCoins } from "../modules/coins/auto-coins";
import { reconcileCoins } from "../modules/coins/ledger";
import { commitImport, parseImport } from "../modules/imports/imports.processor";
import { processDeadline } from "../modules/tests/attempt-finish";
import { refreshTestStatuses } from "../modules/tests/tests.service";

const RELAY_INTERVAL_MS = 1_000;

async function processImport(deps: AppDeps, job: Job<ImportJobPayload>) {
  const { tenantId, importJobId, actorUserId } = job.data;
  const importDeps = { db: deps.db, storage: deps.storage, authState: deps.authState, logger: deps.logger };
  await runWithTenant({ tenantId, userId: actorUserId, requestId: `job:${job.id}` }, async () => {
    if (job.name === "parse") await parseImport(importDeps, importJobId);
    else if (job.name === "commit") await commitImport(importDeps, importJobId);
    else throw new Error(`Unknown import job ${job.name}`);
  });
}

/** Window edges and deadlines: the same idempotent refresh every read does, run on time. */
async function processTests(deps: AppDeps, job: Job<TestJobPayload>) {
  const { tenantId, testId, attemptId } = job.data;
  await runWithTenant({ tenantId, requestId: `job:${job.id}` }, async () => {
    if (job.name === "status" && testId) {
      await refreshTestStatuses(deps.db, { id: testId });
      // The window just closed: final results may earn automatic coins (idempotent).
      await awardTestCoins(deps.db, testId);
    } else if (job.name === "deadline" && attemptId) await processDeadline(deps.db, attemptId);
    else if (job.name === "coins" && testId) await awardTestCoins(deps.db, testId);
    else throw new Error(`Unknown tests job ${job.name}`);
  });
}

/**
 * Technical records with a built-in expiry only (idempotency keys, relayed outbox events). Business and academic
 * data is never deleted here (security-baseline.md S3).
 */
export async function maintenance(deps: AppDeps) {
  const [idempotency, outbox] = await Promise.all([
    deps.root.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    deps.root.outboxEvent.deleteMany({
      where: { status: "PUBLISHED", publishedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
    }),
  ]);
  deps.logger.info({ idempotency: idempotency.count, outbox: outbox.count }, "maintenance done");
  // The cached coin balances must match the ledger; a mismatch is reported, never fixed silently.
  const mismatched = await reconcileCoins(deps.root);
  if (mismatched.length)
    deps.logger.error(
      { accounts: mismatched.map((m) => ({ tenantId: m.tenantId, studentId: m.studentId })) },
      "coin balance mismatch",
    );
}

export async function startWorker(env: Env, logger?: Logger) {
  const deps = buildDeps(env, logger);
  const connection = bullConnection(env.REDIS_URL);

  const imports = new Worker<ImportJobPayload>(QUEUES.imports, (job) => processImport(deps, job), {
    connection,
    concurrency: 2,
  });
  const housekeeping = new Worker(QUEUES.maintenance, () => maintenance(deps), { connection, concurrency: 1 });
  const tests = new Worker<TestJobPayload>(QUEUES.tests, (job) => processTests(deps, job), {
    connection,
    concurrency: 4,
  });
  await deps.queues.maintenance.upsertJobScheduler(
    "daily-cleanup",
    { pattern: "0 3 * * *", tz: "Asia/Tashkent" },
    { name: "cleanup" },
  );

  for (const w of [imports, housekeeping, tests]) {
    w.on("failed", (job, err) =>
      deps.logger.error({ err, jobId: job?.id, queue: w.name, attempts: job?.attemptsMade }, "job failed"),
    );
  }

  let relaying = false;
  const relayTimer = setInterval(() => {
    if (relaying) return;
    relaying = true;
    relayOutbox(deps.root, deps.queues)
      .catch((err: unknown) => deps.logger.error({ err }, "outbox relay failed"))
      .finally(() => {
        relaying = false;
      });
  }, RELAY_INTERVAL_MS);

  deps.logger.info("worker started");
  return {
    deps,
    async stop() {
      clearInterval(relayTimer);
      await Promise.all([imports.close(), housekeeping.close(), tests.close()]);
      await closeDeps(deps);
    },
  };
}
