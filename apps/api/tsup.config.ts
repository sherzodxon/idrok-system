import { defineConfig } from "tsup";

// Workspace packages export TypeScript sources, so they are bundled into the output.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  noExternal: [/^@idrok\//],
  // Prisma query engine pieces and pg stay external (installed in node_modules).
  external: ["@prisma/client", "@prisma/adapter-pg", "pg"],
});
