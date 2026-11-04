// An in-memory Hikvision access terminal for tests and local demos (no real device yet): Digest auth, the ISAPI calls
// IsapiClient uses, an event log, and "HTTP listening" pushes of AccessControllerEvent (multipart, like the firmware)
// to a webhook URL. It recognises nobody by itself: `scan()` plays a face being verified.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseChallenge } from "./client";
import { multipartParts } from "./multipart";

export interface SimulatorOptions {
  username?: string;
  password?: string;
  serialNumber?: string;
  model?: string;
  /** Wall-clock offset of the device, e.g. "+05:00". */
  offset?: string;
}

export interface SimEvent {
  serialNo: number;
  time: string;
  employeeNo: string;
  minor: number;
  attendanceStatus?: string;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

export class HikvisionSimulator {
  readonly users = new Map<string, { name: string }>();
  readonly faces = new Map<string, Buffer>();
  readonly log: SimEvent[] = [];
  /** Webhook pushes that failed (server down): they stay in the log for history reads. */
  readonly failedPushes: SimEvent[] = [];
  webhookUrl: string | null = null;
  /** The next N requests answer 500 (device trouble). */
  failNext = 0;
  /** Requests seen, for assertions ("METHOD /path"). */
  readonly requests: string[] = [];
  private serial = 1;
  private server: Server | null = null;
  private readonly nonce = randomBytes(12).toString("hex");
  private readonly opts: Required<SimulatorOptions>;

  constructor(opts: SimulatorOptions = {}) {
    this.opts = {
      username: opts.username ?? "admin",
      password: opts.password ?? "sim-password",
      serialNumber: opts.serialNumber ?? "DS-K1T341AMF0020230101AAWRSIM0001",
      model: opts.model ?? "DS-K1T341AMF",
      offset: opts.offset ?? "+05:00",
    };
  }

  async start(port = 0, host = "127.0.0.1"): Promise<{ host: string; port: number }> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, host, resolve));
    const addr = this.server.address() as AddressInfo;
    return { host, port: addr.port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** A verified face at `at` (default now): logged and, if a webhook is set, pushed like the firmware does. */
  async scan(
    employeeNo: string,
    opts: { at?: Date; attendanceStatus?: string; minor?: number } = {},
  ): Promise<SimEvent & { pushed: boolean }> {
    const ev: SimEvent = {
      serialNo: this.serial++,
      time: this.localTime(opts.at ?? new Date()),
      employeeNo,
      minor: opts.minor ?? 75,
      ...(opts.attendanceStatus ? { attendanceStatus: opts.attendanceStatus } : {}),
    };
    this.log.push(ev);
    let pushed = false;
    if (this.webhookUrl) {
      const form = new FormData();
      form.append("event_log", JSON.stringify(this.pushBody(ev)));
      form.append("Picture", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "pic.jpg");
      try {
        const res = await fetch(this.webhookUrl, { method: "POST", body: form });
        pushed = res.ok;
      } catch {
        pushed = false;
      }
      if (!pushed) this.failedPushes.push(ev);
    }
    return { ...ev, pushed };
  }

  pushBody(ev: SimEvent) {
    return {
      ipAddress: "127.0.0.1",
      portNo: 80,
      protocol: "HTTP",
      dateTime: ev.time,
      activePostCount: 1,
      eventType: "AccessControllerEvent",
      eventState: "active",
      eventDescription: "Access Controller Event",
      AccessControllerEvent: {
        deviceName: "Access Controller",
        majorEventType: 5,
        subEventType: ev.minor,
        employeeNoString: ev.employeeNo,
        serialNo: ev.serialNo,
        userType: "normal",
        currentVerifyMode: "face",
        ...(ev.attendanceStatus ? { attendanceStatus: ev.attendanceStatus } : {}),
      },
    };
  }

  /** "2026-11-11T08:25:00+05:00" in the device's offset. */
  private localTime(at: Date): string {
    const sign = this.opts.offset.startsWith("-") ? -1 : 1;
    const [h, m] = this.opts.offset.slice(1).split(":").map(Number);
    const local = new Date(at.getTime() + sign * ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
    return `${local.toISOString().slice(0, 19)}${this.opts.offset}`;
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header?.startsWith("Digest ")) return false;
    const c = parseChallenge(header);
    if (c.username !== this.opts.username || c.nonce !== this.nonce) return false;
    const ha1 = md5(`${this.opts.username}:${c.realm}:${this.opts.password}`);
    const ha2 = md5(`${req.method}:${c.uri}`);
    const expected = c.qop
      ? md5(`${ha1}:${c.nonce}:${c.nc}:${c.cnonce}:${c.qop}:${ha2}`)
      : md5(`${ha1}:${c.nonce}:${ha2}`);
    return c.response === expected && c.uri === req.url;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    if (!this.authorized(req)) {
      res.writeHead(401, {
        "WWW-Authenticate": `Digest qop="auth", realm="IP Camera(SIM)", nonce="${this.nonce}", stale="FALSE"`,
      });
      res.end();
      return;
    }
    const path = (req.url ?? "").split("?")[0];
    this.requests.push(`${req.method} ${path}`);
    const ok = (extra: Record<string, unknown> = {}) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ statusCode: 1, statusString: "OK", subStatusCode: "ok", ...extra }));
    };
    const fail = (status: number, sub: string) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ statusCode: 6, statusString: "Invalid Content", subStatusCode: sub }));
    };
    if (this.failNext > 0) {
      this.failNext--;
      return fail(500, "deviceError");
    }
    const json = () => {
      try {
        return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    switch (`${req.method} ${path}`) {
      case "GET /ISAPI/System/deviceInfo":
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><DeviceInfo><deviceName>Simulator</deviceName>` +
            `<model>${this.opts.model}</model><serialNumber>${this.opts.serialNumber}</serialNumber>` +
            `<firmwareVersion>V3.2.30</firmwareVersion></DeviceInfo>`,
        );
        return;
      case "PUT /ISAPI/AccessControl/UserInfo/SetUp": {
        const u = (json().UserInfo ?? {}) as { employeeNo?: string; name?: string };
        if (!u.employeeNo) return fail(400, "badParameters");
        this.users.set(u.employeeNo, { name: u.name ?? "" });
        return ok();
      }
      case "PUT /ISAPI/AccessControl/UserInfo/Delete": {
        const list = ((json().UserInfoDelCond as { EmployeeNoList?: { employeeNo: string }[] }) ?? {}).EmployeeNoList;
        for (const { employeeNo } of list ?? []) {
          this.users.delete(employeeNo);
          this.faces.delete(employeeNo);
        }
        return ok();
      }
      case "POST /ISAPI/Intelligent/FDLib/FaceDataRecord": {
        const parts = multipartParts(body, req.headers["content-type"] ?? "");
        const meta = JSON.parse(parts.get("FaceDataRecord")?.toString("utf8") ?? "{}") as { FPID?: string };
        const img = parts.get("img");
        if (!meta.FPID || !img) return fail(400, "badParameters");
        if (!this.users.has(meta.FPID)) return fail(400, "deviceUserNotExist");
        if (img[0] !== 0xff || img[1] !== 0xd8) return fail(400, "faceDataPicError");
        this.faces.set(meta.FPID, Buffer.from(img));
        return ok({ FPID: meta.FPID });
      }
      case "PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete": {
        for (const { value } of (json().FPID as { value: string }[] | undefined) ?? []) this.faces.delete(value);
        return ok();
      }
      case "POST /ISAPI/Intelligent/FDLib/FDSearch": {
        const fpid = json().FPID as string | undefined;
        const n = fpid && this.faces.has(fpid) ? 1 : 0;
        return ok({ responseStatusStrg: "OK", numOfMatches: n, totalMatches: n });
      }
      case "POST /ISAPI/AccessControl/AcsEvent": {
        const cond = (json().AcsEventCond ?? {}) as {
          searchResultPosition?: number;
          maxResults?: number;
          startTime?: string;
          endTime?: string;
          minor?: number;
        };
        const from = cond.startTime ? new Date(cond.startTime).getTime() : 0;
        const to = cond.endTime ? new Date(cond.endTime).getTime() : Number.MAX_SAFE_INTEGER;
        const match = this.log.filter((e) => {
          const t = new Date(e.time).getTime();
          return t >= from && t <= to && (cond.minor === undefined || e.minor === cond.minor);
        });
        const pos = cond.searchResultPosition ?? 0;
        const page = match.slice(pos, pos + (cond.maxResults ?? 30));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            AcsEvent: {
              searchID: "sim",
              totalMatches: match.length,
              responseStatusStrg: pos + page.length < match.length ? "MORE" : "OK",
              numOfMatches: page.length,
              InfoList: page.map((e) => ({
                major: 5,
                minor: e.minor,
                time: e.time,
                employeeNoString: e.employeeNo,
                serialNo: e.serialNo,
                currentVerifyMode: "face",
                ...(e.attendanceStatus ? { attendanceStatus: e.attendanceStatus } : {}),
              })),
            },
          }),
        );
        return;
      }
      default:
        return fail(404, "notSupport");
    }
  }
}
