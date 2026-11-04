// Secrets at rest (MASTER_SPEC §11 "Biometrik ma'lumotlar shifrlansin"): device passwords and face photos are
// encrypted with AES-256-GCM under DATA_ENCRYPTION_KEY (32 bytes, base64, env only). Machine credentials (device
// webhook keys, bridge tokens) are random and stored only as SHA-256 hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "../http/errors";

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Random URL-safe secret (default 32 bytes = 256 bits). */
export const newSecret = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The key, or null when DATA_ENCRYPTION_KEY is not set (Face ID secrets then cannot be stored). */
export function parseEncryptionKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64");
  return key;
}

export class DataCipher {
  constructor(private readonly key: Buffer | null) {}

  get configured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new AppError("CONFLICT", 409, { reason: "ENCRYPTION_NOT_CONFIGURED" });
    return this.key;
  }

  /** [version][iv][tag][ciphertext] */
  encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.requireKey(), iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  decrypt(sealed: Buffer): Buffer {
    if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) throw new Error("Unknown sealed format");
    const iv = sealed.subarray(1, 1 + IV_BYTES);
    const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.requireKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
  }

  encryptString(plain: string): string {
    return this.encrypt(Buffer.from(plain, "utf8")).toString("base64");
  }

  decryptString(sealed: string): string {
    return this.decrypt(Buffer.from(sealed, "base64")).toString("utf8");
  }
}
