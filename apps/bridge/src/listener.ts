// LAN listener for terminal pushes ("HTTP listening" on the terminal points at http://<bridge-pc>:<port>/hik/<deviceId>).
// A push is accepted only from the terminal's own IP address, written to the disk outbox, then answered 200 — so an
// answered event survives a crash or an internet outage. Snapshot pictures are dropped here (not sent anywhere).
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { multipartParts } from "@idrok/hikvision";
import type { Logger } from "./log";

const MAX_BODY = 4 * 1024 * 1024;

export interface PushedEvent {
  deviceId: string;
  event: unknown;
  receivedAt: string;
}

const isEvent = (v: unknown): boolean =>
  typeof v === "object" && v !== null && typeof (v as { eventType?: unknown }).eventType === "string";

const tryJson = (b: Buffer): unknown => {
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    return undefined;
  }
};

/** The event objects of one terminal push (JSON body or any JSON part of a multipart body). */
export function eventsOf(body: Buffer, contentType: string): unknown[] {
  if (contentType.toLowerCase().startsWith("multipart/")) {
    return [...multipartParts(body, contentType).values()].map(tryJson).filter(isEvent);
  }
  const parsed = tryJson(body);
  return isEvent(parsed) ? [parsed] : [];
}

const normaliseIp = (ip: string | undefined) => (ip ?? "").replace(/^::ffff:/, "");

export class PushListener {
  private server: Server | null = null;

  constructor(
    private readonly opts: {
      /** Known terminals: id → expected source IP (null = refuse, unless allowAnySource). */
      devices: () => Map<string, string | null>;
      store: (e: PushedEvent) => Promise<void>;
      /** GET /status from this PC only (monitoring on site). */
      status?: () => Promise<unknown>;
      log: Logger;
      allowAnySource?: boolean;
    },
  ) {}

  async start(port: number, host = "0.0.0.0"): Promise<number> {
    this.server = createServer((req, res) => {
      this.handle(req).then(
        (r) => {
          const status = typeof r === "number" ? r : r.status;
          res.writeHead(status, { "Content-Type": "application/json" });
          if (typeof r !== "number") res.end(JSON.stringify(r.body));
          else res.end(status === 200 ? '{"statusCode":1,"statusString":"OK"}' : "{}");
        },
        (err: unknown) => {
          this.opts.log.error("push failed", { error: err instanceof Error ? err.message : "unknown" });
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    return (this.server.address() as AddressInfo).port;
  }

  async stop() {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
    this.server = null;
  }

  private async handle(req: IncomingMessage): Promise<number | { status: number; body: unknown }> {
    const local = ["127.0.0.1", "::1"].includes(normaliseIp(req.socket.remoteAddress));
    if (req.method === "GET" && req.url === "/status" && local && this.opts.status) {
      return { status: 200, body: await this.opts.status() };
    }
    const m = /^\/hik\/([0-9a-f-]{36})\/?$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (req.method !== "POST" || !m) return 404;
    const deviceId = m[1]!;
    const devices = this.opts.devices();
    if (!devices.has(deviceId)) return 404;
    const expected = devices.get(deviceId);
    const source = normaliseIp(req.socket.remoteAddress);
    if (!this.opts.allowAnySource && expected !== source) {
      this.opts.log.warn("push from unexpected address", { deviceId, source });
      return 403;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) return 413;
      chunks.push(chunk as Buffer);
    }
    const events = eventsOf(Buffer.concat(chunks), req.headers["content-type"] ?? "");
    const receivedAt = new Date().toISOString();
    for (const event of events) {
      const type = String((event as { eventType: string }).eventType).toLowerCase();
      if (type === "heartbeat") continue;
      await this.opts.store({ deviceId, event, receivedAt });
    }
    return 200;
  }
}
