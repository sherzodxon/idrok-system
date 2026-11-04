// Local demo terminal: `pnpm --filter @idrok/hikvision simulator -- --port 8099 --webhook <url>`.
// Type a student code and Enter to "scan" a face (pushed to the webhook if one is given).
import { createInterface } from "node:readline";
import { HikvisionSimulator } from "./simulator";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const sim = new HikvisionSimulator({ password: arg("password") ?? "sim-password" });
sim.webhookUrl = arg("webhook") ?? null;
const { host, port } = await sim.start(Number(arg("port") ?? 8099), arg("host") ?? "127.0.0.1");
console.log(`Hikvision simulator on http://${host}:${port} (user admin). Type a student code to scan, Ctrl+C to stop.`);
for await (const line of createInterface({ input: process.stdin })) {
  const code = line.trim();
  if (!code) continue;
  const ev = await sim.scan(code);
  console.log(
    `${ev.time} ${code} serial ${ev.serialNo} ${sim.webhookUrl ? (ev.pushed ? "pushed" : "push failed") : ""}`,
  );
}
