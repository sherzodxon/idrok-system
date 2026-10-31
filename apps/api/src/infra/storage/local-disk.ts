import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertSafeKey, type PutOptions, type StorageProvider } from "./storage";

export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer, _opts?: PutOptions) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  get(key: string) {
    return readFile(this.file(key));
  }

  async stream(key: string): Promise<Readable> {
    return createReadStream(this.file(key));
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
