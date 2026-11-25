import type { RunQueue } from "../queue/index.ts";

export function admit(queue: RunQueue, task: number): boolean {
  return queue.push(task);
}

export function next(queue: RunQueue): number | undefined {
  return queue.pop();
}
