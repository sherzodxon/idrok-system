// security-baseline.md S3: secrets are redacted in log output.
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { REDACTED, createLogger } from "../src/logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger("info", stream), lines };
}

describe("log redaction", () => {
  it("hides secrets at the top level, one level deep and in request headers", () => {
    const { logger, lines } = capture();
    const secrets = {
      password: "p-1",
      token: "t-1",
      refreshToken: "r-1",
      authorization: "Bearer a-1",
      cookie: "idrok_at=c-1",
      apiKey: "k-1",
      secret: "s-1",
    };
    logger.info({ ...secrets, body: { ...secrets }, req: { headers: { authorization: "Bearer h-1", cookie: "x=h-2" } } }, "event");
    const out = lines.join("");
    for (const value of ["p-1", "t-1", "r-1", "a-1", "c-1", "k-1", "s-1", "h-1", "h-2"]) expect(out).not.toContain(value);
    const entry = JSON.parse(out) as Record<string, unknown> & { body: Record<string, unknown> };
    for (const key of Object.keys(secrets)) {
      expect(entry[key]).toBe(REDACTED);
      expect(entry.body[key]).toBe(REDACTED);
    }
  });
});
