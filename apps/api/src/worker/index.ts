// Background worker (apps/worker runs this): BullMQ processors, the outbox relay and maintenance.
// Every job runs inside the tenant context taken from its payload.
import { runWithTenant } from "@idrok/db";
import { Worker, type Job } from "bullmq";
import type { Logger } from "pino";
import { buildDeps, closeDeps } from "../bootstrap";
import type { Env } from "../config/env";
import type { AppDeps } from "../deps";
import { alertMessage, createAlertSink, type AlertSink } from "../infra/alerts";
import { relayOutbox } from "../infra/outbox";
import { DataCipher, parseEncryptionKey } from "../infra/crypto";
import {
  QUEUES,
  bullConnection,
  type DeviceJobPayload,
  type ImportJobPayload,
  type TestJobPayload,
} from "../infra/queue";
import { awardAttendanceCoins } from "../modules/attendance/attendance-coins";
import { attendanceSettings } from "../modules/attendance/attendance-config.service";
import { processDirectDevice } from "../modules/attendance/direct-devices";
import { schoolClock } from "../modules/access/school-clock";
import { addSchoolDays } from "@idrok/shared/time";
import { FaceService } from "../modules/attendance/face.service";
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

/** Jobs of a terminal the server reaches directly; the job id is the outbox event, the work is all queued jobs. */
async function processDevices(deps: AppDeps, cipher: DataCipher, job: Job<DeviceJobPayload>) {
  const { tenantId, deviceId } = job.data;
  await runWithTenant({ tenantId, requestId: `job:${job.id}` }, () =>
    processDirectDevice({ db: deps.db, storage: deps.storage, cipher }, deviceId),
  );
}

/**
 * Attendance coins of the last three school days of every school with attendance on (idempotent; a day is awarded
 * once its shift is over, so late bridge deliveries are in).
 */
export async function attendanceCoins(deps: AppDeps, now: Date = new Date()) {
  for (const tenant of await deps.root.tenant.findMany({ select: { id: true } })) {
    await runWithTenant({ tenantId: tenant.id, requestId: "attendance-coins" }, async () => {
      if (!(await attendanceSettings(deps.db)).isEnabled) return;
      const { today } = await schoolClock(deps.db);
      let awarded = 0;
      for (const back of [2, 1, 0]) awarded += await awardAttendanceCoins(deps.db, addSchoolDays(today, -back), now);
      if (awarded) deps.logger.info({ tenantId: tenant.id, awarded }, "attendance coins awarded");
    });
  }
}

/**
 * Technical records with a built-in expiry only (idempotency keys, relayed outbox events). Business and academic
 * data is never deleted here (security-baseline.md S3).
 */
const sinks = new WeakMap<AppDeps, AlertSink>();
/** One alert sink per worker (its throttle state is shared by all jobs of the process). */
function workerAlerts(deps: AppDeps): AlertSink {
  let sink = sinks.get(deps);
  if (!sink) {
    sink = createAlertSink(deps.env.ALERT_WEBHOOK_URL, { service: "worker", environment: deps.env.NODE_ENV });
    sinks.set(deps, sink);
  }
  return sink;
}

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
  if (mismatched.length) {
    deps.logger.error(
      { accounts: mismatched.map((m) => ({ tenantId: m.tenantId, studentId: m.studentId })) },
      "coin balance mismatch",
    );
    workerAlerts(deps).notify({
      kind: "coin_mismatch",
      message: `${mismatched.length} coin account(s) differ from the ledger`,
    });
  }
  // Students who left lose their face on the terminals and on the server (biometric data is not kept).
  const cipher = new DataCipher(parseEncryptionKey(deps.env.DATA_ENCRYPTION_KEY));
  for (const tenant of await deps.root.tenant.findMany({ select: { id: true } })) {
    const cleared = await runWithTenant({ tenantId: tenant.id, requestId: "maintenance" }, () =>
      new FaceService(deps.db, deps.storage, cipher).removeInactive(),
    );
    if (cleared) deps.logger.info({ tenantId: tenant.id, cleared }, "faces of inactive students removed");
    const expired = await runWithTenant({ tenantId: tenant.id, requestId: "maintenance" }, () =>
      new FaceService(deps.db, deps.storage, cipher).removeWithoutConsent(),
    );
    if (expired) deps.logger.info({ tenantId: tenant.id, expired }, "faces without consent removed (Q-54)");
  }
}

export async function startWorker(env: Env, logger?: Logger) {
  const deps = buildDeps(env, logger);
  const connection = bullConnection(env.REDIS_URL);

  const imports = new Worker<ImportJobPayload>(QUEUES.imports, (job) => processImport(deps, job), {
    connection,
    concurrency: 2,
  });
  const housekeeping = new Worker(
    QUEUES.maintenance,
    (job) => (job.name === "attendance-coins" ? attendanceCoins(deps) : maintenance(deps)),
    { connection, concurrency: 1 },
  );
  const tests = new Worker<TestJobPayload>(QUEUES.tests, (job) => processTests(deps, job), {
    connection,
    concurrency: 4,
  });
  const cipher = new DataCipher(parseEncryptionKey(env.DATA_ENCRYPTION_KEY));
  const devices = new Worker<DeviceJobPayload>(QUEUES.devices, (job) => processDevices(deps, cipher, job), {
    connection,
    concurrency: 2,
  });
  await deps.queues.maintenance.upsertJobScheduler(
    "attendance-coins",
    { pattern: "*/30 * * * *", tz: "Asia/Tashkent" },
    { name: "attendance-coins" },
  );
  await deps.queues.maintenance.upsertJobScheduler(
    "daily-cleanup",
    { pattern: "0 3 * * *", tz: "Asia/Tashkent" },
    { name: "cleanup" },
  );

  const alerts = workerAlerts(deps);
  for (const w of [imports, housekeeping, tests, devices]) {
    w.on("failed", (job, err) => {
      deps.logger.error({ err, jobId: job?.id, queue: w.name, attempts: job?.attemptsMade }, "job failed");
      alerts.notify({ kind: "worker_error", message: alertMessage(err), route: `queue ${w.name}` });
    });
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
      await Promise.all([imports.close(), housekeeping.close(), tests.close(), devices.close()]);
      await closeDeps(deps);
    },
  };
}
