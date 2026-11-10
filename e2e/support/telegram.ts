// M7 e2e: a fake Telegram Bot API (records sendMessage calls; GET /sent lists them) and initData signing exactly as
// Telegram does it, so the real webhook → worker → reply path and the Mini App login run end to end.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { TELEGRAM } from "./users";

export interface SentMessage {
  chat_id: string | number;
  text: string;
  reply_markup?: unknown;
}

export async function startFakeTelegram(port: number) {
  const sent: SentMessage[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/sent") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(sent));
    }
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (req.url?.endsWith("/sendMessage")) sent.push(JSON.parse(body) as SentMessage);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return { close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export async function sentMessages(): Promise<SentMessage[]> {
  return (await (await fetch(`${TELEGRAM.apiUrl}/sent`)).json()) as SentMessage[];
}

export function signInitData(userId: number, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: "AAE2E",
    user: JSON.stringify({ id: userId, first_name: "Demo", language_code: "uz" }),
  };
  const pairs = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1));
  const secret = createHmac("sha256", "WebAppData").update(TELEGRAM.botToken).digest();
  const hash = createHmac("sha256", secret)
    .update(pairs.map(([k, v]) => `${k}=${v}`).join("\n"))
    .digest("hex");
  const params = new URLSearchParams(pairs);
  params.set("hash", hash);
  return params.toString();
}
