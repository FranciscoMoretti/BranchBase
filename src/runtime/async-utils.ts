import { setTimeout } from "node:timers/promises";

export const delay = async (milliseconds: number): Promise<void> => {
  await setTimeout(milliseconds);
};
