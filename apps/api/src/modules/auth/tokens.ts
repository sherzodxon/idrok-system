import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

export interface AccessClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
  /** A Telegram Mini App session (T-92): identity proven by Telegram, no temporary-password gate. */
  telegram?: boolean;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    readonly accessTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId, ...(claims.telegram ? { tg: true } : {}) })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  /** Returns the claims, "expired" for an expired but otherwise valid token, or null when invalid. */
  async verifyAccess(token: string): Promise<AccessClaims | "expired" | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || typeof payload.tid !== "string" || typeof payload.sid !== "string") {
        return null;
      }
      return {
        userId: payload.sub,
        tenantId: payload.tid,
        sessionId: payload.sid,
        ...(payload.tg === true ? { telegram: true } : {}),
      };
    } catch (err) {
      return err instanceof joseErrors.JWTExpired ? "expired" : null;
    }
  }
}

/** 256-bit opaque refresh token; only its hash is stored. */
export const newRefreshToken = () => randomBytes(32).toString("base64url");
export const newCsrfToken = () => randomBytes(24).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
