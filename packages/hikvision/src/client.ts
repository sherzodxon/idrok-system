// Hikvision ISAPI client (access control terminals, JSON firmware) over HTTP Digest auth (RFC 7616, MD5, qop=auth).
// Used by the bridge in the school network and by the worker for terminals the server can reach directly.
// Only the calls the Face ID flow needs (MASTER_SPEC §11 "Face ID oqimi"): device info, user records, face data,
// face search and the event log. Credentials are never logged or put into error messages.
import { createHash, randomBytes } from "node:crypto";

export interface DeviceTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  https?: boolean;
  timeoutMs?: number;
}

export class IsapiError extends Error {
  constructor(
    readonly status: number,
    readonly subStatusCode: string | null,
    message: string,
  ) {
    super(message);
  }
  /** "Already gone" answers of delete calls. */
  get notFound(): boolean {
    return (
      this.status === 404 ||
      ["deviceUserNotExist", "noMatchedRecord", "employeeNoNotExist", "notExist"].some((c) =>
        (this.subStatusCode ?? "").toLowerCase().includes(c.toLowerCase()),
      )
    );
  }
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** Parses `Digest realm="x", nonce="y", qop="auth"` (quoted or bare values). */
export function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = header.replace(/^Digest\s+/i, "");
  for (const m of body.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

export function digestHeader(
  challenge: Record<string, string>,
  creds: { username: string; password: string },
  method: string,
  uri: string,
  cnonce = randomBytes(8).toString("hex"),
  nc = "00000001",
): string {
  const realm = challenge.realm ?? "";
  const nonce = challenge.nonce ?? "";
  const ha1 = md5(`${creds.username}:${realm}:${creds.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (challenge.qop ?? "")
    .split(",")
    .map((q) => q.trim())
    .includes("auth")
    ? "auth"
    : null;
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${creds.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    'algorithm="MD5"',
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return `Digest ${parts.join(", ")}`;
}

export interface UserInfo {
  employeeNo: string;
  name: string;
}

export interface DeviceInfo {
  deviceName: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
}

/** An AcsEvent log item in the shape of a pushed AccessControllerEvent (the server parses both the same way). */
export type PushShapedEvent = {
  eventType: "AccessControllerEvent";
  dateTime: string;
  AccessControllerEvent: Record<string, unknown>;
};

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const v: unknown = text ? JSON.parse(text) : {};
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const xmlField = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;

export class IsapiClient {
  constructor(private readonly target: DeviceTarget) {}

  private url(path: string) {
    return `${this.target.https ? "https" : "http"}://${this.target.host}:${this.target.port}${path}`;
  }

  /** One request with a Digest challenge round trip. `body` must be re-sendable (string, Buffer, FormData). */
  async request(
    method: string,
    path: string,
    body?: string | Buffer | FormData,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const timeout = this.target.timeoutMs ?? 15_000;
    const send = (auth?: string) =>
      fetch(this.url(path), {
        method,
        headers: { ...headers, ...(auth ? { Authorization: auth } : {}) },
        body,
        signal: AbortSignal.timeout(timeout),
      });
    let res = await send();
    if (res.status === 401) {
      const challenge = res.headers.get("www-authenticate");
      await res.arrayBuffer();
      if (!challenge?.toLowerCase().startsWith("digest")) throw new IsapiError(401, null, "Device asked for no Digest");
      res = await send(digestHeader(parseChallenge(challenge), this.target, method, path));
    }
    return res;
  }

  private async json(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.request(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? {} : { "Content-Type": "application/json" },
    );
    const text = await res.text();
    const parsed = parseJsonObject(text);
    const statusCode = parsed.statusCode;
    if (!res.ok || (typeof statusCode === "number" && statusCode !== 1)) {
      const sub = typeof parsed.subStatusCode === "string" ? parsed.subStatusCode : null;
      const msg = typeof parsed.errorMsg === "string" ? parsed.errorMsg : (parsed.statusString as string | undefined);
      throw new IsapiError(
        res.status,
        sub,
        `ISAPI ${method} ${path.split("?")[0]}: ${res.status} ${sub ?? msg ?? ""}`.trim(),
      );
    }
    return parsed;
  }

  async deviceInfo(): Promise<DeviceInfo> {
    const res = await this.request("GET", "/ISAPI/System/deviceInfo");
    const xml = await res.text();
    if (!res.ok) throw new IsapiError(res.status, null, `ISAPI GET /ISAPI/System/deviceInfo: ${res.status}`);
    return {
      deviceName: xmlField(xml, "deviceName"),
      model: xmlField(xml, "model"),
      serialNumber: xmlField(xml, "serialNumber"),
      firmwareVersion: xmlField(xml, "firmwareVersion"),
    };
  }

  /** Creates or updates the person record (employeeNo = the student code). */
  async setUpUser(user: UserInfo): Promise<void> {
    await this.json("PUT", "/ISAPI/AccessControl/UserInfo/SetUp?format=json", {
      UserInfo: {
        employeeNo: user.employeeNo,
        name: user.name.slice(0, 32),
        userType: "normal",
        Valid: { enable: true, beginTime: "2020-01-01T00:00:00", endTime: "2037-12-31T23:59:59", timeType: "local" },
        doorRight: "1",
        RightPlan: [{ doorNo: 1, planTemplateNo: "1" }],
      },
    });
  }

  /** Deletes the person and, with it, their face. "Not there" counts as done. */
  async deleteUser(employeeNo: string): Promise<void> {
    try {
      await this.json("PUT", "/ISAPI/AccessControl/UserInfo/Delete?format=json", {
        UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] },
      });
    } catch (e) {
      if (!(e instanceof IsapiError && e.notFound)) throw e;
    }
  }

  async deleteFace(employeeNo: string): Promise<void> {
    try {
      await this.json("PUT", "/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD", {
        FPID: [{ value: employeeNo }],
      });
    } catch (e) {
      if (!(e instanceof IsapiError && e.notFound)) throw e;
    }
  }

  /** Uploads a JPEG face for an existing person (FaceDataRecord, multipart). */
  async uploadFace(employeeNo: string, jpeg: Buffer): Promise<void> {
    const form = new FormData();
    form.append(
      "FaceDataRecord",
      new Blob([JSON.stringify({ faceLibType: "blackFD", FDID: "1", FPID: employeeNo })], { type: "application/json" }),
    );
    form.append("img", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "face.jpg");
    const res = await this.request("POST", "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json", form);
    const text = await res.text();
    const parsed = parseJsonObject(text);
    if (!res.ok || (typeof parsed.statusCode === "number" && parsed.statusCode !== 1)) {
      const sub = typeof parsed.subStatusCode === "string" ? parsed.subStatusCode : null;
      throw new IsapiError(res.status, sub, `ISAPI POST FaceDataRecord: ${res.status} ${sub ?? ""}`.trim());
    }
  }

  async hasFace(employeeNo: string): Promise<boolean> {
    const r = await this.json("POST", "/ISAPI/Intelligent/FDLib/FDSearch?format=json", {
      searchResultPosition: 0,
      maxResults: 1,
      faceLibType: "blackFD",
      FDID: "1",
      FPID: employeeNo,
    });
    return Number(r.numOfMatches ?? 0) > 0;
  }

  /** Verified-face events of [from, to] from the terminal's log, oldest first, in pushed-event shape. */
  async searchEvents(from: string, to: string, opts: { minor?: number; pageSize?: number; max?: number } = {}) {
    const out: PushShapedEvent[] = [];
    const searchID = randomBytes(8).toString("hex");
    const pageSize = opts.pageSize ?? 30;
    const max = opts.max ?? 5000;
    for (let position = 0; out.length < max;) {
      const r = await this.json("POST", "/ISAPI/AccessControl/AcsEvent?format=json", {
        AcsEventCond: {
          searchID,
          searchResultPosition: position,
          maxResults: pageSize,
          major: 5,
          minor: opts.minor ?? 75,
          startTime: from,
          endTime: to,
        },
      });
      const acs = (r.AcsEvent ?? {}) as { InfoList?: Record<string, unknown>[]; responseStatusStrg?: string };
      const list = acs.InfoList ?? [];
      for (const e of list) {
        out.push({
          eventType: "AccessControllerEvent",
          dateTime: String(e.time),
          AccessControllerEvent: {
            majorEventType: e.major,
            subEventType: e.minor,
            employeeNoString: e.employeeNoString,
            serialNo: e.serialNo,
            attendanceStatus: e.attendanceStatus,
            currentVerifyMode: e.currentVerifyMode,
          },
        });
      }
      position += list.length;
      if (list.length === 0 || acs.responseStatusStrg !== "MORE") break;
    }
    return out;
  }
}
