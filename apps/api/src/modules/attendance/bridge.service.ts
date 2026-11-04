// The bridge side of the protocol (MASTER_SPEC §11 "Bridge"): the agent in the school network polls over outbound HTTPS
// with its bearer token. Token rotation keeps the previous token valid for a short overlap, so a request in flight
// during the switch is not lost. All calls run in the bridge's tenant, taken from its token.
import type { Db, RootClient } from "@idrok/db";
import type { z } from "zod";
import type { BridgeEventsSchema, BridgeHeartbeatSchema } from "@idrok/shared";
import { AppError, notFound } from "../../http/errors";
import { newSecret, sha256Hex, type DataCipher } from "../../infra/crypto";
import type { StorageProvider } from "../../infra/storage";
import { writeAudit } from "../audit/audit.service";
import { BRIDGE_TOKEN_OVERLAP_MS } from "./devices.service";
import { ingestEvents } from "./ingest";

export const POLL_SECONDS = 10;
/** The bridge is asked to rotate its token once it is older than this. */
export const TOKEN_MAX_AGE_MS = 30 * 86_400_000;

export interface BridgeIdentity {
  id: string;
  tenantId: string;
}

/** Finds the active bridge of a bearer token (current, or previous within the overlap). */
export async function authenticateBridge(root: RootClient, header: string | undefined): Promise<BridgeIdentity | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const hash = sha256Hex(header.slice(7).trim());
  const agent = await root.bridgeAgent.findFirst({
    where: {
      isActive: true,
      OR: [{ tokenHash: hash }, { previousTokenHash: hash, previousTokenExpiresAt: { gt: new Date() } }],
    },
    select: { id: true, tenantId: true },
  });
  return agent;
}

/** A photo for a face job, decrypted for the bridge (the request is TLS-protected). */
export async function jobPhoto(
  db: Db,
  storage: StorageProvider,
  cipher: DataCipher,
  jobId: string,
  owner: { bridgeAgentId: string | null },
): Promise<Buffer> {
  const job = await db.bridgeJob.findFirst({
    where: { id: jobId, status: "LEASED", type: "FACE_UPSERT", bridgeAgentId: owner.bridgeAgentId },
    select: {
      faceSync: {
        select: { student: { select: { faceProfile: { select: { photoAsset: { select: { storageKey: true } } } } } } },
      },
    },
  });
  const key = job?.faceSync?.student.faceProfile[0]?.photoAsset?.storageKey;
  if (!key) throw notFound();
  return cipher.decrypt(await storage.get(key));
}

export class BridgeService {
  constructor(
    private readonly db: Db,
    private readonly cipher: DataCipher,
  ) {}

  async heartbeat(bridge: BridgeIdentity, input: z.infer<typeof BridgeHeartbeatSchema>) {
    const now = new Date();
    const agent = await this.db.bridgeAgent.update({
      where: { id: bridge.id },
      data: { lastSeenAt: now, version: input.version, hostname: input.hostname, queueDepth: input.queueDepth },
      select: { tokenRotatedAt: true },
    });
    const devices = await this.db.device.findMany({
      where: { bridgeAgentId: bridge.id, useBridge: true, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ipAddress: true,
        port: true,
        username: true,
        passwordEnc: true,
        direction: true,
        isActive: true,
      },
    });
    const mine = new Set(devices.map((d) => d.id));
    for (const d of input.devices) {
      if (!mine.has(d.deviceId)) continue;
      await this.db.device.update({
        where: { id: d.deviceId },
        data: d.reachable ? { lastSeenAt: now } : { lastError: (d.error ?? "unreachable").slice(0, 300) },
      });
    }
    return {
      serverTime: now.toISOString(),
      pollSeconds: POLL_SECONDS,
      rotateToken: now.getTime() - agent.tokenRotatedAt.getTime() > TOKEN_MAX_AGE_MS,
      devices: devices.map(({ passwordEnc, ...d }) => ({
        ...d,
        password: passwordEnc ? this.cipher.decryptString(passwordEnc) : null,
      })),
    };
  }

  /** The bridge's own rotation: the old token keeps working for a short overlap. */
  async rotateToken(bridge: BridgeIdentity): Promise<{ token: string }> {
    const token = newSecret();
    await this.db.$transaction(async (tx) => {
      const agent = await tx.bridgeAgent.findUniqueOrThrow({ where: { id: bridge.id }, select: { tokenHash: true } });
      await tx.bridgeAgent.update({
        where: { id: bridge.id },
        data: {
          tokenHash: sha256Hex(token),
          previousTokenHash: agent.tokenHash,
          previousTokenExpiresAt: new Date(Date.now() + BRIDGE_TOKEN_OVERLAP_MS),
          tokenRotatedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        action: "bridge.self_rotate_token",
        entityType: "BridgeAgent",
        entityId: bridge.id,
        actorUserId: null,
      });
    });
    return { token };
  }

  async events(bridge: BridgeIdentity, input: z.infer<typeof BridgeEventsSchema>) {
    const device = await this.db.device.findFirst({
      where: { id: input.deviceId, bridgeAgentId: bridge.id, archivedAt: null },
      select: { id: true, direction: true, isActive: true },
    });
    if (!device) throw notFound();
    if (!device.isActive) {
      return { accepted: 0, duplicates: 0, ignored: input.events.length, unmatched: 0 };
    }
    const { lastEventAt, ...counts } = await ingestEvents(this.db, device, input.events, input.source);
    await this.db.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), ...(lastEventAt ? { lastEventAt } : {}) },
    });
    return counts;
  }
}

export const bridgeUnauthorized = () => new AppError("AUTH_REQUIRED", 401);
