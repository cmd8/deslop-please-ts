export class Tally {
  readonly #counts: number[];

  constructor(levels: number) {
    this.#counts = new Array<number>(Math.max(levels, 1)).fill(0);
  }

  record(level: number): void {
    const slot = this.slot(level);
    this.#counts[slot] = (this.#counts[slot] ?? 0) + 1;
  }

  count(level: number): number {
    return this.#counts[this.slot(level)] ?? 0;
  }

  total(): number {
    return this.#counts.reduce((sum, count) => sum + count, 0);
  }

  busiest(): number {
    let busiest = 0;
    this.#counts.forEach((count, level) => {
      if (count > (this.#counts[busiest] ?? 0)) {
        busiest = level;
      }
    });
    return busiest;
  }

  private slot(level: number): number {
    return Math.min(level, this.#counts.length - 1);
  }
}
