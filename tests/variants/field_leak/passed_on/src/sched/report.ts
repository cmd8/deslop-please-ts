import type { RunQueue } from "../queue/index.ts";

export function backlog(queue: RunQueue): number {
  return queue.waiting();
}

export function drained(queue: RunQueue): boolean {
  return queue.waiting() === 0;
}
