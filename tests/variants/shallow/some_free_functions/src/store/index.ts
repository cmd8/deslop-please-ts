import { Table } from "./table.ts";

export class Store {
  readonly #table = new Table();
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  limit(): number {
    return this.#limit;
  }

  insert(key: number, value: number): boolean {
    if (this.#table.count() >= this.#limit) {
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
    return this.#limit - this.#table.count();
  }

  isFull(): boolean {
    return this.room() === 0;
  }
}

export function total(store: Store, keys: readonly number[]): number {
  let sum = 0;
  for (const key of keys) {
    sum += store.get(key) ?? 0;
  }
  return sum;
}

export function largest(store: Store, keys: readonly number[]): number | undefined {
  let most: number | undefined;
  for (const key of keys) {
    const value = store.get(key);
    if (value !== undefined) {
      most = Math.max(most ?? 0, value);
    }
  }
  return most;
}
