// BullMQ queues. Producers (API, outbox relay) and consumers (apps/worker) share these names and payload types.
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUES = {
  imports: "imports",
  maintenance: "maintenance",
  tests: "tests",
  devices: "devices",
  telegram: "telegram",
  notifications: "notifications",
} as const;

export interface ImportJobPayload {
  tenantId: string;
  importJobId: string;
  actorUserId: string;
}

/** Test window edges and attempt deadlines (delivered when due: the outbox event's availableAt). */
export interface TestJobPayload {
  tenantId: string;
  testId?: string;
  attemptId?: string;
}

/** Jobs of a terminal the server reaches directly (no bridge). */
export interface DeviceJobPayload {
  tenantId: string;
  deviceId: string;
}

/** A bot update stored by the webhook (M7). */
export interface TelegramJobPayload {
  tenantId: string;
  telegramUpdateId: string;
}

/** Notification work (M7): fan out an event to guardians, or deliver one message. */
export interface NotificationJobPayload {
  tenantId: string;
  notificationId?: string;
  studentId?: string;
  schoolDate?: string;
  testId?: string;
}

export type JobRoute = { queue: keyof typeof QUEUES; name: string };

/** Outbox event type → queue job. Events without a route are only recorded (consumers arrive in later stages). */
export const EVENT_ROUTES: Record<string, JobRoute> = {
  "import.parse_requested": { queue: "imports", name: "parse" },
  "import.commit_requested": { queue: "imports", name: "commit" },
  "test.status_due": { queue: "tests", name: "status" },
  "attempt.deadline_due": { queue: "tests", name: "deadline" },
  "coins.test_results_due": { queue: "tests", name: "coins" },
  "devices.jobs_due": { queue: "devices", name: "run" },
  "telegram.update_received": { queue: "telegram", name: "update" },
  "notification.deliver": { queue: "notifications", name: "deliver" },
  "notify.arrival": { queue: "notifications", name: "arrival" },
  "notify.departure": { queue: "notifications", name: "departure" },
  "notify.test_results": { queue: "notifications", name: "test-results" },
};

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 86_400 },
  removeOnFail: { age: 30 * 86_400 },
} as const;

/** Worker/queue connections need maxRetriesPerRequest: null (BullMQ requirement). */
export const bullConnection = (url: string): ConnectionOptions =>
  new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true }) as unknown as ConnectionOptions;

export function createQueues(url: string) {
  const connection = bullConnection(url);
  const queues = {
    imports: new Queue(QUEUES.imports, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    maintenance: new Queue(QUEUES.maintenance, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    tests: new Queue(QUEUES.tests, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    devices: new Queue(QUEUES.devices, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    telegram: new Queue(QUEUES.telegram, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    notifications: new Queue(QUEUES.notifications, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  };
  return {
    queues,
    close: async () => {
      await Promise.all(Object.values(queues).map((q) => q.close()));
    },
  };
}
export type Queues = ReturnType<typeof createQueues>["queues"];
