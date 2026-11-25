import type { RunQueue } from "../queue/index.ts";

export function backlog(queue: RunQueue): number {
  const [most] = queue.limit();
  return Math.min(queue.backlog(), most);
}

export function drained(queue: RunQueue): boolean {
  const [most] = queue.limit();
  return queue.backlog() === 0 || queue.head === most;
}
