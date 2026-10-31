import type { Request } from "express";
import type { z } from "zod";

/** Parses request parts with zod; throws ZodError (→ 400 VALIDATION_ERROR). */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

export const parseBody = <T extends z.ZodType>(req: Request, schema: T) => parse(schema, req.body ?? {});
export const parseQuery = <T extends z.ZodType>(req: Request, schema: T) => parse(schema, req.query);
export const parseParams = <T extends z.ZodType>(req: Request, schema: T) => parse(schema, req.params);
