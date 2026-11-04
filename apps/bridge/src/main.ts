// idrok-bridge <command> [--data-dir DIR]
//   setup --server URL --token TOKEN [--port 8090]   save the configuration and the token (once, on the school PC)
//   run                                              start the agent (what the Windows service runs)
//   status                                           print the local agent's status (GET http://127.0.0.1:<port>/status)
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BridgeAgent } from "./agent";
import { defaultDataDir, loadConfig, saveSetup } from "./config";
import { createLogger } from "./log";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const command = args[0];
const dataDir = flag("data-dir") ?? defaultDataDir();

async function main() {
  await mkdir(dataDir, { recursive: true });
  if (command === "setup") {
    const server = flag("server");
    const token = flag("token");
    if (!server || !token) throw new Error("setup needs --server and --token");
    const cfg = await saveSetup(
      dataDir,
      { serverUrl: server, ...(flag("port") ? { listenPort: Number(flag("port")) } : {}) },
      token,
    );
    process.stdout.write(`Saved ${join(dataDir, "bridge.json")} (server ${cfg.serverUrl}, port ${cfg.listenPort})\n`);
    return;
  }
  const cfg = await loadConfig(dataDir);
  if (command === "status") {
    const res = await fetch(`http://127.0.0.1:${cfg.listenPort}/status`);
    process.stdout.write(`${JSON.stringify(await res.json(), null, 2)}\n`);
    return;
  }
  if (command !== "run") throw new Error("usage: idrok-bridge setup|run|status [--data-dir DIR]");
  const log = createLogger({ dir: join(dataDir, "logs"), level: cfg.logLevel });
  const agent = new BridgeAgent({
    serverUrl: cfg.serverUrl,
    dataDir,
    listenPort: cfg.listenPort,
    listenHost: cfg.listenHost,
    catchUpMinutes: cfg.catchUpMinutes,
    log,
  });
  await agent.start();
  const shutdown = () => {
    log.info("stopping");
    void agent.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
