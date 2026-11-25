export type Limit = readonly [most: number];

export class RunQueue {
  readonly #items: number[] = [];
  head = 0;
  readonly #limit: Limit;

  constructor(limit: number) {
    this.#limit = [limit];
  }

  push(task: number): boolean {
    if (this.backlog() >= this.#limit[0]) {
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

  limit(): Limit {
    return this.#limit;
  }
}
