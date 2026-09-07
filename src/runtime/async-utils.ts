import { setTimeout } from "node:timers/promises";

export async function delay(milliseconds: number): Promise<void> {
  await setTimeout(milliseconds);
}
