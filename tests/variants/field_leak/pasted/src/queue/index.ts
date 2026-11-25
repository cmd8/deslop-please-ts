import { RunQueue } from "./ring.ts";

export { RunQueue, admit, backlog, drained, next } from "./ring.ts";

export function fresh(limit: number): RunQueue {
  return new RunQueue(limit);
}
