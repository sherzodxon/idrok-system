// OpenAPI 3.1 document assembled from the zod schemas that the routes validate with (single source).
import { z } from "zod";
import type { RouteDef } from "../http/route";

export class OpenApiRegistry {
  private readonly routes: RouteDef[] = [];

  add(def: RouteDef) {
    this.routes.push(def);
  }

  document(info: { title: string; version: string }) {
    const paths: Record<string, Record<string, unknown>> = {};
    const schema = (s: z.ZodType, io: "input" | "output") => z.toJSONSchema(s, { io, unrepresentable: "any" });

    for (const def of this.routes) {
      const path = `/api/v1${def.path.replace(/:(\w+)/g, "{$1}")}`;
      const parameters: unknown[] = [];
      for (const [where, s] of [
        ["path", def.params],
        ["query", def.query],
      ] as const) {
        if (!s) continue;
        const json = schema(s, "input") as { properties?: Record<string, unknown>; required?: string[] };
        for (const [name, prop] of Object.entries(json.properties ?? {})) {
          parameters.push({
            name,
            in: where,
            required: where === "path" || json.required?.includes(name),
            schema: prop,
          });
        }
      }
      const responses: Record<string, unknown> = {};
      for (const [status, r] of Object.entries(def.responses)) {
        responses[status] = {
          description: r.description,
          ...(r.schema ? { content: { "application/json": { schema: schema(r.schema, "output") } } } : {}),
        };
      }
      (paths[path] ??= {})[def.method] = {
        summary: def.summary,
        tags: def.tags,
        ...(def.access !== "public" ? { security: [{ cookieAuth: [] }, { bearerAuth: [] }] } : {}),
        ...(typeof def.access === "string" && def.access.includes(".") ? { "x-permission": def.access } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(def.body
          ? { requestBody: { required: true, content: { "application/json": { schema: schema(def.body, "input") } } } }
          : {}),
        responses,
      };
    }

    return {
      openapi: "3.1.0",
      info,
      paths,
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: "idrok_at" },
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    };
  }
}
