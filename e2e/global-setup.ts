import { startStack } from "./support/stack";

export default async function globalSetup() {
  const stop = await startStack();
  return stop;
}
