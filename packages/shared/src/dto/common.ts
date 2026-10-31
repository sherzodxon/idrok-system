import { z } from "zod";
import { isSchoolDate, type SchoolDate } from "../time";

export const SchoolDateSchema = z
  .string()
  .refine(isSchoolDate, { message: "invalid_school_date" })
  .transform((v) => v as SchoolDate);

export const IdParamsSchema = z.object({ id: z.uuid() });

/** ?page=&pageSize=&sort=&q= (CLAUDE.md §5). `sort` is "field" or "-field", comma separated. */
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z]+(,-?[a-zA-Z]+)*$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** E.164 Uzbek mobile number, normalised on input. */
export const PersonNameSchema = z.string().trim().min(1).max(80);
