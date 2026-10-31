import type { TestProject } from "vitest/node";
import { startTestDatabase } from "../src/testing";

export default async function setup(project: TestProject) {
  const db = await startTestDatabase();
  project.provide("databaseUrl", db.url);
  return () => db.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
