// JSON-lines log to stdout and to a size-rotated file in the data directory (the Windows service has no console).
// Callers never pass tokens or device passwords.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(opts: { dir?: string; level?: Level; stdout?: boolean } = {}): Logger {
  const min = ORDER[opts.level ?? "info"];
  const file = opts.dir ? join(opts.dir, "bridge.log") : null;
  if (opts.dir) mkdirSync(opts.dir, { recursive: true });
  const rotate = () => {
    if (!file) return;
    try {
      if (statSync(file).size < MAX_BYTES) return;
    } catch {
      return;
    }
    for (let i = KEEP - 1; i >= 1; i--) {
      try {
        renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      } catch {
        // missing older file
      }
    }
    renameSync(file, `${file}.1`);
  };
  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...data });
    if (opts.stdout !== false) process.stdout.write(`${line}\n`);
    if (file) {
      rotate();
      appendFileSync(file, `${line}\n`);
    }
  };
  return {
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
  };
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
