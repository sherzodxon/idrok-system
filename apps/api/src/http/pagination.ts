import type { ListQuery, Page } from "@idrok/shared";
import { AppError } from "./errors";

type Direction = "asc" | "desc";

/**
 * Turns `sort=lastName,-createdAt` into a Prisma orderBy, allowing only the listed fields (anything else is a 400).
 */
export function orderBy<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  fallback: Partial<Record<F, Direction>>[],
) {
  if (!sort) return fallback;
  return sort.split(",").map((part) => {
    const desc = part.startsWith("-");
    const field = (desc ? part.slice(1) : part) as F;
    if (!allowed.includes(field))
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "sort", code: "unknown_field" }] });
    return { [field]: desc ? "desc" : "asc" } as Partial<Record<F, Direction>>;
  });
}

export const skipTake = (q: ListQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

export const page = <T>(items: T[], total: number, q: ListQuery): Page<T> => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
});
