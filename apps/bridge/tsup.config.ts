import { defineConfig } from "tsup";

// One self-contained file for the school PC: the workspace ISAPI client and zod are bundled, Node 24 is the only
// requirement (no npm install on site).
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  noExternal: [/.*/],
});
