// One date shape in every locale, in the school's time zone.
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/format";

describe("format", () => {
  it("dd.mm.yyyy HH:MM in Tashkent time", () => {
    // 2026-11-04 19:29:05 UTC = 2026-11-05 00:29:05 in Tashkent.
    const at = new Date(Date.UTC(2026, 10, 4, 19, 29, 5));
    expect(formatDateTime(at)).toBe("05.11.2026 00:29");
    expect(formatDateTime(at, true)).toBe("05.11.2026 00:29:05");
    expect(formatDate(at)).toBe("05.11.2026");
    expect(formatDateTime(null)).toBe("—");
  });
});
