// Outbound HTTPS calls to the Idrok API (/api/v1/bridge/*) with the bridge's bearer token. The bridge never accepts
// connections from the internet; it only polls.
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BridgeDevice {
  id: string;
  name: string;
  ipAddress: string | null;
  port: number;
  username: string | null;
  password: string | null;
  direction: "IN" | "OUT" | "BOTH";
  isActive: boolean;
}

export interface Heartbeat {
  serverTime: string;
  pollSeconds: number;
  utcOffset: string;
  rotateToken: boolean;
  devices: BridgeDevice[];
}

export interface LeasedJob {
  id: string;
  deviceId: string;
  type: "FACE_UPSERT" | "FACE_DELETE" | "FACE_CHECK" | "DEVICE_INFO" | "EVENT_HISTORY";
  payload: Record<string, unknown>;
  leasedUntil: string;
}

export interface IngestCounts {
  accepted: number;
  duplicates: number;
  ignored: number;
  unmatched: number;
}

export class ServerApi {
  constructor(
    private readonly baseUrl: string,
    private token: string,
    private readonly timeoutMs = 20_000,
  ) {}

  setToken(token: string) {
    this.token = token;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      throw new ServerError(res.status, `${method} ${path} → ${res.status}`);
    }
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.call(method, path, body)).json()) as T;
  }

  heartbeat(body: {
    version: string;
    hostname: string;
    queueDepth: number;
    devices: { deviceId: string; reachable: boolean; error?: string | null }[];
  }) {
    return this.json<Heartbeat>("POST", "/bridge/heartbeat", body);
  }

  lease(max: number) {
    return this.json<LeasedJob[]>("POST", "/bridge/jobs/lease", { max });
  }

  async photo(jobId: string): Promise<Buffer> {
    return Buffer.from(await (await this.call("GET", `/bridge/jobs/${jobId}/photo`)).arrayBuffer());
  }

  result(jobId: string, body: { ok: boolean; error?: string | null; result?: Record<string, unknown> | null }) {
    return this.json<{ recorded: boolean }>("POST", `/bridge/jobs/${jobId}/result`, body);
  }

  events(deviceId: string, source: "WEBHOOK" | "HISTORY", events: unknown[]) {
    return this.json<IngestCounts>("POST", "/bridge/events", { deviceId, source, events });
  }

  rotateToken() {
    return this.json<{ token: string }>("POST", "/bridge/token/rotate");
  }
}
