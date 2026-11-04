// Jobs of terminals the server reaches itself (useBridge = false; e.g. a VPN to the school network): the worker plays
// the bridge's part with the same ISAPI code. Runs inside the device's tenant context.
import type { Db } from "@idrok/db";
import { IsapiClient, runDeviceJob } from "@idrok/hikvision";
import type { DataCipher } from "../../infra/crypto";
import type { StorageProvider } from "../../infra/storage";
import { jobPhoto } from "./bridge.service";
import { completeJob, leaseJobs } from "./device-jobs";
import { ingestEvents } from "./ingest";

const MAX_ROUNDS = 20;

export async function processDirectDevice(
  deps: { db: Db; storage: StorageProvider; cipher: DataCipher },
  deviceId: string,
): Promise<number> {
  const device = await deps.db.device.findFirst({
    where: { id: deviceId, archivedAt: null, useBridge: false },
    select: { id: true, direction: true, ipAddress: true, port: true, username: true, passwordEnc: true },
  });
  if (!device) return 0;
  if (!device.ipAddress) {
    await deps.db.device.update({ where: { id: device.id }, data: { lastError: "no IP address" } });
    return 0;
  }
  const client = new IsapiClient({
    host: device.ipAddress,
    port: device.port,
    username: device.username ?? "admin",
    password: device.passwordEnc ? deps.cipher.decryptString(device.passwordEnc) : "",
  });
  let done = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const jobs = await leaseJobs(deps.db, { directDeviceId: device.id }, 10);
    if (!jobs.length) break;
    for (const job of jobs) {
      const outcome = await runDeviceJob(client, job, () =>
        jobPhoto(deps.db, deps.storage, deps.cipher, job.id, { bridgeAgentId: null }),
      );
      if (outcome.ok && outcome.events?.length) await ingestEvents(deps.db, device, outcome.events, "HISTORY");
      await completeJob(deps.db, job.id, { direct: true }, outcome);
      done++;
    }
  }
  return done;
}
