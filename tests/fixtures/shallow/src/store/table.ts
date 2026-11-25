export class Table {
  readonly #keys: number[] = [];
  readonly #values: number[] = [];

  count(): number {
    return this.#keys.length;
  }

  put(key: number, value: number): void {
    const at = this.find(key);
    if (at === undefined) {
      this.#keys.push(key);
      this.#values.push(value);
    } else {
      this.#values[at] = value;
    }
  }

  find(key: number): number | undefined {
    const at = this.#keys.indexOf(key);
    return at < 0 ? undefined : at;
  }

  value(at: number): number {
    return this.#values[at] ?? 0;
  }

  take(at: number): number {
    const value = this.value(at);
    this.#keys.splice(at, 1);
    this.#values.splice(at, 1);
    return value;
  }
}
