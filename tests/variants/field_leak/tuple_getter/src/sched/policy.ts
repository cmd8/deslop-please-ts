import type { RunQueue } from "../queue/index.ts";

export function admit(queue: RunQueue, task: number): boolean {
  if (queue.full()) {
    return false;
  }
  const [items] = queue.parts();
  items.push(task);
  return true;
}

export function next(queue: RunQueue): number | undefined {
  const [items, head] = queue.parts();
  const task = items[head];
  if (task === undefined) {
    return undefined;
  }
  queue.setParts(items, head + 1);
  return task;
}
