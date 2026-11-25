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

  get items(): number[] {
    return this.#items;
  }

  get head(): number {
    return this.#head;
  }

  set head(head: number) {
    this.#head = head;
  }
}
