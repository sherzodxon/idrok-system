import type { ScoreCriterionDto } from "@idrok/shared";

/** "1–4", "≤ 4", "≥ 1" or "" for a criterion without bounds (the API checks them, this only shows them). */
export function boundsText(c: Pick<ScoreCriterionDto, "minPoints" | "maxPoints">): string {
  if (c.minPoints && c.maxPoints) return `${c.minPoints}–${c.maxPoints}`;
  if (c.maxPoints) return `≤ ${c.maxPoints}`;
  if (c.minPoints) return `≥ ${c.minPoints}`;
  return "";
}
