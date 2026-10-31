// Proves the project lint rules actually catch what CLAUDE.md forbids (and leave normal code alone).
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { baseConfig, webConfig } from "../eslint/index.mjs";

async function ruleIds(code: string, filePath: string, config: unknown): Promise<string[]> {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config as ESLint.Options["overrideConfig"] });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

describe("time rules", () => {
  it("rejects local Date getters and setters", async () => {
    const ids = await ruleIds(
      "const d = new Date(); d.setHours(0, 0, 0, 0); export const x = d.getDate();",
      "apps/api/src/a.ts",
      baseConfig,
    );
    expect(ids.filter((id) => id === "no-restricted-syntax")).toHaveLength(2);
  });

  it("rejects new Date(string)", async () => {
    const ids = await ruleIds('export const d = new Date("2026-10-31");', "apps/api/src/a.ts", baseConfig);
    expect(ids).toContain("no-restricted-syntax");
  });

  it("allows Date math inside the shared time module", async () => {
    const ids = await ruleIds(
      "export const h = new Date().getHours();",
      "packages/shared/src/time/zone.ts",
      baseConfig,
    );
    expect(ids).not.toContain("no-restricted-syntax");
  });

  it("allows instants and ISO strings", async () => {
    const ids = await ruleIds("export const now = new Date().toISOString();", "apps/api/src/a.ts", baseConfig);
    expect(ids).toEqual([]);
  });
});

describe("colour rules (web)", () => {
  it("rejects arbitrary Tailwind colours", async () => {
    const ids = await ruleIds('export const c = "flex bg-[#4E92CF] p-2";', "apps/web/src/a.tsx", webConfig);
    expect(ids).toContain("no-restricted-syntax");
  });

  it("rejects arbitrary colours in template literals", async () => {
    const ids = await ruleIds(
      "export const c = (x: string) => `${x} hover:text-[rgb(1,2,3)]`;",
      "apps/web/src/a.tsx",
      webConfig,
    );
    expect(ids).toContain("no-restricted-syntax");
  });

  it("rejects raw hex colours", async () => {
    const ids = await ruleIds('export const style = { color: "#fff" };', "apps/web/src/a.tsx", webConfig);
    expect(ids).toContain("no-restricted-syntax");
  });

  it("allows semantic token classes", async () => {
    const ids = await ruleIds(
      'export const c = "bg-primary text-on-primary w-[240px]";',
      "apps/web/src/a.tsx",
      webConfig,
    );
    expect(ids).toEqual([]);
  });

  it("forbids importing the database from the web app", async () => {
    const ids = await ruleIds(
      'import { prisma } from "@idrok/db";\nexport const p = prisma;',
      "apps/web/src/a.ts",
      webConfig,
    );
    expect(ids).toContain("no-restricted-imports");
  });
});
