export class RunQueue {
  #items: number[] = [];
  #head = 0;
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  full(): boolean {
    return this.#items.length - this.#head >= this.#limit;
  }

  parts(): [items: number[], head: number] {
    return [this.#items, this.#head];
  }

  setParts(items: number[], head: number): void {
    this.#items = items;
    this.#head = head;
  }
}
