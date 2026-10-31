import { defineConfig } from "prisma/config";

// Migrations always run over the direct connection (DIRECT_URL); the app uses the pooler (DATABASE_URL).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "" },
});
