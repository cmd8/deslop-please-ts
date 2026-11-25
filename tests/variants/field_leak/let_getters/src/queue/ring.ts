export class RunQueue {
  readonly #items: number[] = [];
  #head = 0;
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  full(): boolean {
    return this.#items.length - this.#head >= this.#limit;
  }

  items(): number[] {
    const items = this.#items;
    return items;
  }

  withItems<R>(each: (items: number[]) => R): R {
    return each(this.#items);
  }

  head(): number {
    const head = this.#head;
    return head;
  }

  setHead(head: number): void {
    this.#head = head;
  }
}
