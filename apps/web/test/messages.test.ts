// CLAUDE.md §4: every UI text exists in uz and ru. Also: every API error code and role has a translation.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, SYSTEM_ROLES } from "@idrok/shared";
import { NAV } from "../src/components/shell/nav-config";

type Tree = { [k: string]: string | Tree };
const load = (locale: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, `../messages/${locale}.json`), "utf8")) as Tree;
const keys = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const uz = load("uz");
const ru = load("ru");

describe("translations", () => {
  it("uz and ru have exactly the same keys", () => {
    expect(keys(ru).sort()).toEqual(keys(uz).sort());
  });

  it("no empty strings and the same placeholders", () => {
    const get = (tree: Tree, key: string) =>
      key.split(".").reduce<string | Tree>((t, k) => (t as Tree)[k]!, tree) as string;
    for (const key of keys(uz)) {
      expect(get(uz, key).trim(), key).not.toBe("");
      expect(get(ru, key).trim(), key).not.toBe("");
      expect(placeholders(get(ru, key)), key).toEqual(placeholders(get(uz, key)));
    }
  });

  it("covers every API error code, every system role and every menu item", () => {
    const all = new Set(keys(uz));
    for (const code of ERROR_CODES) expect(all.has(`errors.${code}`), code).toBe(true);
    for (const role of SYSTEM_ROLES) expect(all.has(`roles.${role}`), role).toBe(true);
    for (const item of [...NAV.school, ...NAV.teacher]) expect(all.has(`nav.${item.key}`), item.key).toBe(true);
  });
});
