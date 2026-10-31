// Walks the Express router and lists every served route with its declared access rule (security-baseline.md S1).
import type { Router } from "express";
import type { OpenApiRegistry } from "../openapi/registry";
import { routeId } from "./public-routes";
import type { Access } from "./route";

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

export interface ServedRoute {
  id: string;
  method: string;
  path: string;
  /** Undefined when the route was registered without defineRoute (no declared access rule). */
  access: Access | undefined;
}

function walk(stack: Layer[], out: { method: string; path: string }[]) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const path of paths) {
        for (const [method, on] of Object.entries(layer.route.methods))
          if (on && method !== "_all") out.push({ method, path });
      }
    } else if (layer.handle?.stack) {
      // Nested routers mounted at "/" (e.g. the health router).
      walk(layer.handle.stack, out);
    }
  }
}

export function servedRoutes(router: Router, registry: OpenApiRegistry): ServedRoute[] {
  const found: { method: string; path: string }[] = [];
  walk((router as unknown as { stack: Layer[] }).stack, found);
  const declared = new Map(registry.definitions().map((d) => [routeId(d.method, d.path), d.access]));
  return found.map(({ method, path }) => {
    const id = routeId(method, path);
    return { id, method, path, access: declared.get(id) };
  });
}
