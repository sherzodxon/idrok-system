// Every translation key the code uses literally exists (CLAUDE.md §4: all UI text is in the message files).
// `const t = useTranslations("ns")` binds a namespace; `t("a.b")` is then looked up as "ns.a.b". Keys built at run time
// (`t(\`kinds.${k}\`)`) cannot be checked here — their namespaces are covered by messages.test.ts parity.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import uz from "../messages/uz.json";

const SRC = path.resolve(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

function has(key: string): boolean {
  let node: unknown = uz;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

/** Each call resolves against the nearest preceding `useTranslations` binding of the same name (one per component). */
function usedKeys(source: string): string[] {
  const bindings = [...source.matchAll(/const (\w+) = useTranslations\((?:"([\w.]+)")?\)/g)].map((m) => ({
    name: m[1]!,
    ns: m[2],
    at: m.index,
  }));
  const keys: string[] = [];
  for (const name of new Set(bindings.map((b) => b.name))) {
    for (const m of source.matchAll(new RegExp(`\\b${name}(?:\\.(?:rich|has))?\\("([\\w.]+)"`, "g"))) {
      const binding = bindings.filter((b) => b.name === name && b.at < m.index).at(-1);
      if (!binding) continue;
      keys.push(binding.ns ? `${binding.ns}.${m[1]}` : m[1]!);
    }
  }
  return keys;
}

describe("translation keys used in code", () => {
  const all = files(SRC).flatMap((f) => usedKeys(readFileSync(f, "utf8")).map((key) => ({ file: f, key })));

  it("finds the keys (sanity check)", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("all exist in the uz messages (ru parity is checked by messages.test.ts)", () => {
    const missing = all.filter((u) => !has(u.key)).map((u) => `${path.relative(SRC, u.file)}: ${u.key}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
