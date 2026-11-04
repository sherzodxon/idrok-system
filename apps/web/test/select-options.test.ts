// The custom Select reads ordinary <option> children and searches long lists regardless of case, accents and the
// different Uzbek apostrophes.
import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { filterOptions, normalizeSearch, optionsFromChildren } from "@/lib/select-options";

const opt = (value: string | undefined, label: string, disabled = false) =>
  createElement("option", { key: `${value}-${label}`, value, disabled }, label);

describe("select options", () => {
  it("reads <option> children through fragments and arrays", () => {
    const children = [
      opt("", "—"),
      createElement(Fragment, { key: "f" }, [opt("a", "Alpha"), opt("b", "Beta", true)]),
      createElement("option", { key: "n" }, "No value", " ", 7),
      null,
      false,
    ];
    expect(optionsFromChildren(children)).toEqual([
      { value: "", label: "—", disabled: false },
      { value: "a", label: "Alpha", disabled: false },
      { value: "b", label: "Beta", disabled: true },
      { value: "No value 7", label: "No value 7", disabled: false },
    ]);
  });

  it("search ignores case, accents and apostrophe variants; every word must match", () => {
    expect(normalizeSearch("  Oʻzbek  TILI ")).toBe("ozbek tili");
    expect(normalizeSearch("Ўзбек")).toBe("узбек");
    const options = ["O'zbek tili", "Ona tili", "Rus tili", "Matematika 7-A"].map((label) => ({
      value: label,
      label,
      disabled: false,
    }));
    expect(filterOptions(options, "ozbek").map((o) => o.label)).toEqual(["O'zbek tili"]);
    expect(filterOptions(options, "oʻz").map((o) => o.label)).toEqual(["O'zbek tili"]);
    expect(filterOptions(options, "tili ona").map((o) => o.label)).toEqual(["Ona tili"]);
    expect(filterOptions(options, "7-a").map((o) => o.label)).toEqual(["Matematika 7-A"]);
    expect(filterOptions(options, "7a").map((o) => o.label)).toEqual(["Matematika 7-A"]);
    expect(filterOptions(options, "matematika7").map((o) => o.label)).toEqual(["Matematika 7-A"]);
    expect(filterOptions(options, "  ")).toHaveLength(4);
    expect(filterOptions(options, "fizika")).toEqual([]);
  });
});
