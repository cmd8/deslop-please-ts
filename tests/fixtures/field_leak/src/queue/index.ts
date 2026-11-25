import { RunQueue } from "./ring.ts";

export { RunQueue } from "./ring.ts";

export function fresh(limit: number): RunQueue {
  return new RunQueue(limit);
}
