import { Table } from "./table.ts";

export class Store {
  readonly #table = new Table();
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  insert(key: number, value: number): boolean {
    if (this.#table.count() >= this.limit) {
      return false;
    }
    this.#table.put(key, value);
    return true;
  }

  get(key: number): number | undefined {
    const at = this.#table.find(key);
    return at === undefined ? undefined : this.#table.value(at);
  }

  remove(key: number): number | undefined {
    const at = this.#table.find(key);
    return at === undefined ? undefined : this.#table.take(at);
  }

  contains(key: number): boolean {
    return this.#table.find(key) !== undefined;
  }

  room(): number {
    return this.limit - this.#table.count();
  }

  isFull(): boolean {
    return this.room() === 0;
  }

  total(): number {
    let sum = 0;
    for (let at = 0; at < this.#table.count(); at += 1) {
      sum += this.#table.value(at);
    }
    return sum;
  }

  largest(): number | undefined {
    let most: number | undefined;
    for (let at = 0; at < this.#table.count(); at += 1) {
      most = Math.max(most ?? 0, this.#table.value(at));
    }
    return most;
  }
}
