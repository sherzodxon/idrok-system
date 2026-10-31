// Supabase Storage over its REST API (no client SDK, CLAUDE.md §3). Private bucket; the service key stays on the server.
import { Readable } from "node:stream";
import { assertSafeKey, type PutOptions, type StorageProvider } from "./storage";

export class SupabaseStorage implements StorageProvider {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(key: string) {
    assertSafeKey(key);
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async put(key: string, body: Buffer, opts: PutOptions) {
    const res = await this.fetchImpl(this.endpoint(key), {
      method: "POST",
      headers: this.headers({ "Content-Type": opts.contentType, "x-upsert": "false" }),
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
  }

  async get(key: string) {
    const res = await this.fetchImpl(this.endpoint(key), { headers: this.headers() });
    if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async stream(key: string) {
    return Readable.from(await this.get(key));
  }

  async delete(key: string) {
    const res = await this.fetchImpl(this.endpoint(key), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed: ${res.status}`);
  }
}
