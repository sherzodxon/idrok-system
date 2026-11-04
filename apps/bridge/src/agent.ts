// The bridge agent (MASTER_SPEC §11 "Bridge"): every poll it
//  1. sends a heartbeat (version, host, queue depth, which terminals answer) and gets its terminals with credentials;
//  2. flushes the disk outbox — events pushed by terminals and job results not yet delivered;
//  3. rotates its token when the server asks (the new token is on disk before it is used);
//  4. leases device jobs and runs them over ISAPI (face upload/removal/check, device info, event log);
//  5. reads the terminals' own event logs back for the time since the last read (after an outage of the internet,
//     the server, this PC or the terminal's pushes — the server stores each terminal event once, so overlap is safe).
// Terminal passwords live only in memory; the token lives in the data directory.
import { hostname } from "node:os";
import { join } from "node:path";
import { IsapiClient, runDeviceJob, type DeviceTarget } from "@idrok/hikvision";
import { PushListener, type PushedEvent } from "./listener";
import type { Logger } from "./log";
import { ServerApi, ServerError, type BridgeDevice, type Heartbeat } from "./server-api";
import { DiskQueue, readJson, writeAtomic } from "./store";

export const BRIDGE_VERSION = "0.1.0";
const EVENT_BATCH = 200;
const PROBE_EVERY_MS = 60_000;
const OVERLAP_MS = 5 * 60_000;
const MAX_CATCH_UP_MS = 7 * 86_400_000;

interface PendingResult {
  jobId: string;
  ok: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
}

interface State {
  /** Per terminal: up to when its event log has been read back and delivered. */
  cursors: Record<string, string>;
  /** Terminal id → its IP address, so pushes are accepted right after a restart (before the first heartbeat). */
  terminals: Record<string, string | null>;
  lastHeartbeatAt: string | null;
}

export interface AgentOptions {
  serverUrl: string;
  dataDir: string;
  listenPort: number;
  listenHost?: string;
  log: Logger;
  /** Minutes between event-log reads per terminal (also right after an outage). */
  catchUpMinutes?: number;
  allowAnySource?: boolean;
  /** false: no timer, the caller drives tick() (tests). */
  autoPoll?: boolean;
  now?: () => Date;
}

export interface AgentStatus {
  version: string;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  serverReachable: boolean;
  outboxEvents: number;
  pendingResults: number;
  devices: { id: string; name: string; reachable: boolean | null; lastError: string | null }[];
}

export class BridgeAgent {
  private api!: ServerApi;
  private token = "";
  private devices = new Map<string, BridgeDevice>();
  private reachability = new Map<string, { reachable: boolean; error: string | null; at: number }>();
  private state: State = { cursors: {}, terminals: {}, lastHeartbeatAt: null };
  private readonly events: DiskQueue<PushedEvent>;
  private readonly results: DiskQueue<PendingResult>;
  private readonly listener: PushListener;
  private pollSeconds = 10;
  private utcOffset = "+05:00";
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private serverReachable = false;
  private outage = true;
  private lastError: string | null = null;
  private lastCatchUp = new Map<string, number>();
  listenPort = 0;

  constructor(private readonly opts: AgentOptions) {
    this.events = new DiskQueue(join(opts.dataDir, "outbox", "events"));
    this.results = new DiskQueue(join(opts.dataDir, "outbox", "results"));
    this.listener = new PushListener({
      devices: () => new Map(Object.entries(this.state.terminals)),
      store: async (e) => {
        await this.events.push(e);
      },
      status: () => this.status(),
      log: opts.log,
      allowAnySource: opts.allowAnySource,
    });
  }

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  private get tokenPath() {
    return join(this.opts.dataDir, "token");
  }

  private get statePath() {
    return join(this.opts.dataDir, "state.json");
  }

  async start(): Promise<void> {
    await this.events.init();
    await this.results.init();
    this.token = (await readJson<{ token?: string }>(this.tokenPath, {})).token ?? "";
    if (!this.token) throw new Error(`No bridge token in ${this.tokenPath}: run "setup" first`);
    this.api = new ServerApi(this.opts.serverUrl, this.token);
    this.state = { ...this.state, ...(await readJson<Partial<State>>(this.statePath, {})) };
    this.listenPort = await this.listener.start(this.opts.listenPort, this.opts.listenHost);
    this.opts.log.info("bridge started", { version: BRIDGE_VERSION, listenPort: this.listenPort });
    if (this.opts.autoPoll !== false) this.schedule(0);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
    await this.listener.stop();
  }

  private schedule(ms: number) {
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        if (this.timer) this.schedule(this.pollSeconds * 1000);
      });
    }, ms);
  }

  /** One poll; a call during a running poll waits for it, then polls again. Never throws. */
  async tick(): Promise<void> {
    while (this.running) await this.running;
    this.running = this.poll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async poll(): Promise<void> {
    try {
      let hb: Heartbeat;
      try {
        hb = await this.api.heartbeat({
          version: BRIDGE_VERSION,
          hostname: hostname().slice(0, 120),
          queueDepth: (await this.events.size()) + (await this.results.size()),
          devices: [...this.reachability.entries()]
            .filter(([id]) => this.devices.has(id))
            .map(([deviceId, r]) => ({ deviceId, reachable: r.reachable, error: r.error })),
        });
      } catch (e) {
        this.fail("server unreachable", e);
        this.serverReachable = false;
        this.outage = true;
        return;
      }
      const recovered = this.outage;
      this.serverReachable = true;
      this.outage = false;
      this.lastError = null;
      this.pollSeconds = hb.pollSeconds;
      this.utcOffset = hb.utcOffset;
      this.devices = new Map(hb.devices.filter((d) => d.isActive).map((d) => [d.id, d]));
      this.state.terminals = Object.fromEntries([...this.devices.values()].map((d) => [d.id, d.ipAddress]));
      this.state.lastHeartbeatAt = this.now().toISOString();
      await writeAtomic(this.statePath, JSON.stringify(this.state));
      // Reachability goes to the next heartbeat.
      await this.probeDevices();
      await this.flushEvents();
      await this.flushResults();
      if (hb.rotateToken) await this.rotateToken();
      await this.runJobs();
      await this.catchUp(recovered);
      await writeAtomic(this.statePath, JSON.stringify(this.state));
    } catch (e) {
      this.fail("poll failed", e);
    }
  }

  private fail(msg: string, e: unknown) {
    this.lastError = e instanceof Error ? e.message : String(e);
    this.opts.log.warn(msg, { error: this.lastError });
  }

  private client(d: BridgeDevice): IsapiClient | null {
    if (!d.ipAddress) return null;
    const target: DeviceTarget = {
      host: d.ipAddress,
      port: d.port,
      username: d.username ?? "admin",
      password: d.password ?? "",
      timeoutMs: 10_000,
    };
    return new IsapiClient(target);
  }

  private async probeDevices() {
    const now = Date.now();
    for (const d of this.devices.values()) {
      const last = this.reachability.get(d.id);
      if (last && now - last.at < PROBE_EVERY_MS) continue;
      const client = this.client(d);
      if (!client) {
        this.reachability.set(d.id, { reachable: false, error: "no IP address", at: now });
        continue;
      }
      try {
        await client.deviceInfo();
        if (last && !last.reachable) this.lastCatchUp.delete(d.id); // back online: read its log now
        this.reachability.set(d.id, { reachable: true, error: null, at: now });
      } catch (e) {
        this.reachability.set(d.id, { reachable: false, error: (e as Error).message.slice(0, 300), at: now });
      }
    }
  }

  private async flushEvents() {
    for (;;) {
      const batch = await this.events.peek(EVENT_BATCH);
      if (!batch.length) return;
      const byDevice = new Map<string, typeof batch>();
      for (const item of batch) byDevice.set(item.value.deviceId, [...(byDevice.get(item.value.deviceId) ?? []), item]);
      for (const [deviceId, items] of byDevice) {
        try {
          await this.api.events(
            deviceId,
            "WEBHOOK",
            items.map((i) => i.value.event),
          );
        } catch (e) {
          // A terminal that is no longer ours: its events can never be delivered.
          if (!(e instanceof ServerError && e.status === 404)) throw e;
          this.opts.log.warn("events dropped for an unknown terminal", { deviceId, count: items.length });
        }
        await this.events.remove(items.map((i) => i.id));
      }
    }
  }

  private async flushResults() {
    for (const item of await this.results.peek(100)) {
      const { jobId, ...body } = item.value;
      await this.api.result(jobId, body);
      await this.results.remove([item.id]);
    }
  }

  private async rotateToken() {
    const { token } = await this.api.rotateToken();
    await writeAtomic(this.tokenPath, JSON.stringify({ token }));
    this.token = token;
    this.api.setToken(token);
    this.opts.log.info("token rotated");
  }

  private async runJobs() {
    for (;;) {
      const jobs = await this.api.lease(10);
      if (!jobs.length) return;
      for (const job of jobs) {
        const device = this.devices.get(job.deviceId);
        const client = device ? this.client(device) : null;
        const outcome = client
          ? await runDeviceJob(client, job, () => this.api.photo(job.id))
          : { ok: false, error: device ? "no IP address" : "terminal not assigned to this bridge" };
        if (outcome.ok && "events" in outcome && outcome.events?.length) {
          for (let i = 0; i < outcome.events.length; i += EVENT_BATCH) {
            await this.api.events(job.deviceId, "HISTORY", outcome.events.slice(i, i + EVENT_BATCH));
          }
        }
        const pending: PendingResult = {
          jobId: job.id,
          ok: outcome.ok,
          error: outcome.error ?? null,
          result: ("result" in outcome ? outcome.result : null) ?? null,
        };
        try {
          await this.api.result(job.id, { ok: pending.ok, error: pending.error, result: pending.result });
        } catch (e) {
          await this.results.push(pending);
          throw e;
        }
        this.opts.log.info("job done", { jobId: job.id, type: job.type, ok: outcome.ok, error: outcome.error });
      }
    }
  }

  /** "2026-11-11T08:00:00+05:00" for the school's offset. */
  private local(d: Date): string {
    const sign = this.utcOffset.startsWith("-") ? -1 : 1;
    const [h, m] = this.utcOffset.slice(1).split(":").map(Number);
    const shifted = new Date(d.getTime() + sign * ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
    return `${shifted.toISOString().slice(0, 19)}${this.utcOffset}`;
  }

  private async catchUp(force: boolean) {
    const now = this.now();
    const every = (this.opts.catchUpMinutes ?? 15) * 60_000;
    for (const d of this.devices.values()) {
      const r = this.reachability.get(d.id);
      if (r && !r.reachable) continue;
      const last = this.lastCatchUp.get(d.id);
      if (!force && last !== undefined && now.getTime() - last < every) continue;
      const client = this.client(d);
      if (!client) continue;
      const cursor = this.state.cursors[d.id] ? new Date(this.state.cursors[d.id]!) : new Date(now.getTime() - every);
      const from = new Date(Math.max(cursor.getTime() - OVERLAP_MS, now.getTime() - MAX_CATCH_UP_MS));
      try {
        const events = await client.searchEvents(this.local(from), this.local(now));
        for (let i = 0; i < events.length; i += EVENT_BATCH) {
          await this.api.events(d.id, "HISTORY", events.slice(i, i + EVENT_BATCH));
        }
        this.state.cursors[d.id] = now.toISOString();
        this.lastCatchUp.set(d.id, now.getTime());
        if (events.length) this.opts.log.info("event log read back", { deviceId: d.id, count: events.length });
      } catch (e) {
        this.fail("event log read failed", e);
      }
    }
  }

  async status(): Promise<AgentStatus> {
    return {
      version: BRIDGE_VERSION,
      lastHeartbeatAt: this.state.lastHeartbeatAt,
      lastError: this.lastError,
      serverReachable: this.serverReachable,
      outboxEvents: await this.events.size(),
      pendingResults: await this.results.size(),
      devices: [...this.devices.values()].map((d) => ({
        id: d.id,
        name: d.name,
        reachable: this.reachability.get(d.id)?.reachable ?? null,
        lastError: this.reachability.get(d.id)?.error ?? null,
      })),
    };
  }
}
