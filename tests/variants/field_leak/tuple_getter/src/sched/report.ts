import type { RunQueue } from "../queue/index.ts";

export function backlog(queue: RunQueue): number {
  const [items, head] = queue.parts();
  return items.length - head;
}

export function drained(queue: RunQueue): boolean {
  const [items, head] = queue.parts();
  return head === items.length;
}
