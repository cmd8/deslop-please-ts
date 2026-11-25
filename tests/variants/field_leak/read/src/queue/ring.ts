export class RunQueue {
  readonly #items: number[] = [];
  head = 0;
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(task: number): boolean {
    if (this.backlog() >= this.#limit) {
      return false;
    }
    this.#items.push(task);
    return true;
  }

  pop(): number | undefined {
    const task = this.#items[this.head];
    if (task === undefined) {
      return undefined;
    }
    this.head += 1;
    return task;
  }

  backlog(): number {
    return this.#items.length - this.head;
  }

  limit(): number {
    return this.#limit;
  }
}
