import type { RunQueue } from "../queue/index.ts";

export function backlog(queue: RunQueue): number {
  return queue.items().length - queue.head();
}

export function drained(queue: RunQueue): boolean {
  return queue.head() === queue.items().length;
}
