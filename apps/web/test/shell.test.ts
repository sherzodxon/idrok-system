import { describe, expect, it } from "vitest";
import { NAV, availableContexts, groupNav } from "../src/components/shell/nav-config";
import { dataTheme } from "../src/lib/theme";

describe("navigation contexts", () => {
  it("offers both menus to a teacher who is also a deputy director", () => {
    expect(availableContexts(["TEACHER", "DEPUTY_DIRECTOR"])).toEqual(["school", "teacher"]);
    expect(availableContexts(["CLASS_TEACHER"])).toEqual(["teacher"]);
    expect(availableContexts(["KUTUBXONACHI"])).toEqual(["school"]);
  });
});

describe("navigation groups", () => {
  it("each group is one unbroken section, in menu order", () => {
    for (const items of Object.values(NAV)) {
      const groups = groupNav(items).map((g) => g.group);
      expect(new Set(groups).size, groups.join()).toBe(groups.length);
    }
    expect(groupNav(NAV.school).map((g) => g.group)).toEqual([
      "main",
      "people",
      "teaching",
      "assessment",
      "attendance",
      "rewards",
      "system",
    ]);
    expect(groupNav(NAV.teacher).map((g) => g.group)).toEqual(["today", "lesson", "prep", "people"]);
  });
});

describe("theme", () => {
  it("SYSTEM leaves the choice to the OS", () => {
    expect(dataTheme("LIGHT")).toBe("light");
    expect(dataTheme("DARK")).toBe("dark");
    expect(dataTheme("SYSTEM")).toBeUndefined();
  });
});
