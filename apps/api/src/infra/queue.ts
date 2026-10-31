// BullMQ queues. Producers (API, outbox relay) and consumers (apps/worker) share these names and payload types.
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUES = { imports: "imports", maintenance: "maintenance" } as const;

export interface ImportJobPayload {
  tenantId: string;
  importJobId: string;
  actorUserId: string;
}

export type JobRoute = { queue: keyof typeof QUEUES; name: string };

/** Outbox event type → queue job. Events without a route are only recorded (consumers arrive in later stages). */
export const EVENT_ROUTES: Record<string, JobRoute> = {
  "import.parse_requested": { queue: "imports", name: "parse" },
  "import.commit_requested": { queue: "imports", name: "commit" },
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
  };
  return {
    queues,
    close: async () => {
      await Promise.all(Object.values(queues).map((q) => q.close()));
    },
  };
}
export type Queues = ReturnType<typeof createQueues>["queues"];
