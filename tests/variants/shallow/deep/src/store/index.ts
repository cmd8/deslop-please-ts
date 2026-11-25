import { Table } from "./table.ts";

export class Store {
  readonly #table = new Table();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  load(pairs: ReadonlyArray<readonly [key: number, value: number]>): number {
    for (const [key, value] of pairs) {
      if (this.isFull() || !this.insert(key, value)) {
        this.remove(key);
      }
    }
    return pairs.filter(([key]) => this.contains(key)).length;
  }

  summary(): number {
    let found = 0;
    for (let at = 0; at < this.#table.count(); at += 1) {
      if (this.get(this.#table.value(at)) !== undefined) {
        found += 1;
      }
    }
    return this.total() + (this.largest() ?? 0) + found + this.room();
  }

  private insert(key: number, value: number): boolean {
    if (this.#table.count() >= this.#limit) {
      return false;
    }
    this.#table.put(key, value);
    return true;
  }

  private get(key: number): number | undefined {
    const at = this.#table.find(key);
    return at === undefined ? undefined : this.#table.value(at);
  }

  private remove(key: number): number | undefined {
    const at = this.#table.find(key);
    return at === undefined ? undefined : this.#table.take(at);
  }

  private contains(key: number): boolean {
    return this.#table.find(key) !== undefined;
  }

  private room(): number {
    return this.#limit - this.#table.count();
  }

  private isFull(): boolean {
    return this.room() === 0;
  }

  private total(): number {
    let sum = 0;
    for (let at = 0; at < this.#table.count(); at += 1) {
      sum += this.#table.value(at);
    }
    return sum;
  }

  private largest(): number | undefined {
    let most: number | undefined;
    for (let at = 0; at < this.#table.count(); at += 1) {
      most = Math.max(most ?? 0, this.#table.value(at));
    }
    return most;
  }
}
