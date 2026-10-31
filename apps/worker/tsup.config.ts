import { defineConfig } from "tsup";

// Workspace packages (including the API code the worker runs) are bundled; npm dependencies stay external.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  noExternal: [/^@idrok\//],
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
});
