import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "../src/lib/csp";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe("Content-Security-Policy", () => {
  const csp = buildCsp({ nonce: "abc", apiUrl: "https://api.example.uz/api/v1" });

  it("runs only nonce-tagged scripts, never eval or inline handlers", () => {
    expect(directive(csp, "script-src")).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "object-src")).toBe("'none'");
  });

  it("talks to the API origin only, and cannot be framed", () => {
    expect(directive(csp, "connect-src")).toBe("'self' https://api.example.uz");
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows eval only for next dev", () => {
    const dev = buildCsp({ nonce: "abc", apiUrl: "http://localhost:4000/api/v1", dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("nonces are fresh and 128-bit", () => {
    const a = createNonce();
    expect(atob(a)).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });
});
