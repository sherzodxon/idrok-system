import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "../src/infra/storage/local-disk";
import { storageKey } from "../src/infra/storage/storage";
import { SupabaseStorage } from "../src/infra/storage/supabase";

const TENANT = "0190f5c2-0000-7000-8000-000000000001";
const FILE = "0190f5c2-0000-7000-8000-000000000002";
const key = storageKey(TENANT, "IMPORT_SOURCE", FILE, "xlsx");

describe("storage keys", () => {
  it("have one safe shape", () => {
    expect(key).toBe(`${TENANT}/import_source/${FILE}.xlsx`);
  });
});

describe("LocalDiskStorage", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idrok-storage-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const storage = new LocalDiskStorage(dir);

  it("stores, reads and deletes", async () => {
    await storage.put(key, Buffer.from("demo"), { contentType: "text/plain" });
    expect((await storage.get(key)).toString()).toBe("demo");
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it("refuses keys that could escape the directory", async () => {
    await expect(storage.put("../../etc/passwd", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(
      /Unsafe/,
    );
  });
});

describe("SupabaseStorage (REST, no SDK)", () => {
  it("sends the service key only in headers and uses the private bucket path", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(init.method === "DELETE" ? null : "demo", { status: 200 });
    }) as unknown as typeof fetch;
    const storage = new SupabaseStorage("https://demo.supabase.co/", "service-key-demo", "idrok-files", fakeFetch);
    await storage.put(key, Buffer.from("demo"), { contentType: "text/plain" });
    expect((await storage.get(key)).toString()).toBe("demo");
    await storage.delete(key);
    expect(calls.map((c) => c.init.method ?? "GET")).toEqual(["POST", "GET", "DELETE"]);
    for (const c of calls) {
      expect(c.url).toBe(`https://demo.supabase.co/storage/v1/object/idrok-files/${key}`);
      expect(c.url).not.toContain("service-key-demo");
      expect((c.init.headers as Record<string, string>).Authorization).toBe("Bearer service-key-demo");
    }
  });

  it("surfaces upload failures", async () => {
    const failing = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    const storage = new SupabaseStorage("https://demo.supabase.co", "k", "b", failing);
    await expect(storage.put(key, Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(/403/);
  });
});
