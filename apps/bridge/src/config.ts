// bridge.json in the data directory (default C:\ProgramData\IdrokBridge on Windows, ./.data/bridge elsewhere).
// The token is kept in a separate file next to it (`token`, readable only by the service account).
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeAtomic } from "./store";

export const ConfigSchema = z.object({
  /** API base URL ending in /api/v1, e.g. https://api.<domain>/api/v1 */
  serverUrl: z.url(),
  /** LAN port terminals push events to (their "HTTP listening" target). */
  listenPort: z.number().int().min(1).max(65_535).default(8090),
  listenHost: z.string().default("0.0.0.0"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  catchUpMinutes: z.number().int().min(1).max(1440).default(15),
});
export type BridgeConfig = z.infer<typeof ConfigSchema>;

export function defaultDataDir(): string {
  if (process.platform === "win32") return join(process.env.ProgramData ?? "C:\\ProgramData", "IdrokBridge");
  return join(process.cwd(), ".data", "bridge");
}

export async function loadConfig(dataDir: string): Promise<BridgeConfig> {
  const raw = await readJson<unknown>(join(dataDir, "bridge.json"), null);
  if (raw === null) throw new Error(`No ${join(dataDir, "bridge.json")}: run "setup" first`);
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`Invalid bridge.json: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return parsed.data;
}

export async function saveSetup(dataDir: string, config: Partial<BridgeConfig> & { serverUrl: string }, token: string) {
  const full = ConfigSchema.parse(config);
  await writeAtomic(join(dataDir, "bridge.json"), JSON.stringify(full, null, 2), 0o644);
  await writeAtomic(join(dataDir, "token"), JSON.stringify({ token }));
  return full;
}
