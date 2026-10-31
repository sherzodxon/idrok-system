import { describe, expect, it } from "vitest";
import { availableContexts } from "../src/components/shell/nav-config";
import { dataTheme } from "../src/lib/theme";

describe("navigation contexts", () => {
  it("offers both menus to a teacher who is also a deputy director", () => {
    expect(availableContexts(["TEACHER", "DEPUTY_DIRECTOR"])).toEqual(["school", "teacher"]);
    expect(availableContexts(["CLASS_TEACHER"])).toEqual(["teacher"]);
    expect(availableContexts(["KUTUBXONACHI"])).toEqual(["school"]);
  });
});

describe("theme", () => {
  it("SYSTEM leaves the choice to the OS", () => {
    expect(dataTheme("LIGHT")).toBe("light");
    expect(dataTheme("DARK")).toBe("dark");
    expect(dataTheme("SYSTEM")).toBeUndefined();
  });
});
