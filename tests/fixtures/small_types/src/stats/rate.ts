export class Rate {
  #last: number;
  #lines = 0;

  constructor(private readonly first: number) {
    this.#last = first;
  }

  observe(second: number): void {
    this.#last = Math.max(this.#last, second);
    this.#lines += 1;
  }

  perSecond(): number {
    return Math.floor(this.#lines / this.span());
  }

  private span(): number {
    return this.#last - this.first + 1;
  }
}
