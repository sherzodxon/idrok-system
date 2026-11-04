// Disk storage of the bridge: an outbox of items not yet accepted by the server (terminal events, job results) and a
// small JSON state file. Every write is a temp file + fsync + rename, so a power cut leaves either the old or the new
// file, never half of one. Items are deleted only after the server confirmed them (no event is lost when the internet
// or the server is down — they wait here).
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export async function writeAtomic(path: string, data: string | Buffer, mode = 0o600): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  const fh = await open(tmp, "w", mode);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export interface QueueItem<T> {
  id: string;
  value: T;
}

/** A directory of JSON files, oldest first (file names sort by creation time). */
export class DiskQueue<T> {
  private seq = 0;
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // Leftovers of an interrupted write are never valid items.
    for (const f of await readdir(this.dir)) if (f.endsWith(".tmp")) await rm(join(this.dir, f), { force: true });
  }

  async push(value: T): Promise<string> {
    const id = `${Date.now().toString().padStart(15, "0")}-${String(this.seq++ % 1e6).padStart(6, "0")}-${randomBytes(3).toString("hex")}`;
    await writeAtomic(join(this.dir, `${id}.json`), JSON.stringify(value));
    return id;
  }

  async peek(max: number): Promise<QueueItem<T>[]> {
    const files = (await readdir(this.dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(0, max);
    const out: QueueItem<T>[] = [];
    for (const f of files) {
      try {
        out.push({ id: f.slice(0, -5), value: JSON.parse(await readFile(join(this.dir, f), "utf8")) as T });
      } catch {
        // A broken item would block the queue forever: set it aside.
        await rename(join(this.dir, f), join(this.dir, `${f}.broken`)).catch(() => undefined);
      }
    }
    return out;
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) await rm(join(this.dir, `${id}.json`), { force: true });
  }

  async size(): Promise<number> {
    return (await readdir(this.dir)).filter((f) => f.endsWith(".json")).length;
  }
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}
