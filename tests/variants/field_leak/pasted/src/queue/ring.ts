export class RunQueue {
  items: number[] = [];
  head = 0;

  constructor(private readonly limit: number) {}

  full(): boolean {
    return this.items.length - this.head >= this.limit;
  }
}

export function admit(queue: RunQueue, task: number): boolean {
  if (queue.full()) {
    return false;
  }
  queue.items.push(task);
  return true;
}

export function next(queue: RunQueue): number | undefined {
  const task = queue.items[queue.head];
  if (task === undefined) {
    return undefined;
  }
  queue.head += 1;
  return task;
}

export function backlog(queue: RunQueue): number {
  return queue.items.length - queue.head;
}

export function drained(queue: RunQueue): boolean {
  return queue.head === queue.items.length;
}
