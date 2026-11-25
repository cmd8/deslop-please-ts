import { Store, largest, total } from "./store/index.ts";

export function run(pairs: ReadonlyArray<readonly [key: number, value: number]>): number {
  const store = new Store(8);
  for (const [key, value] of pairs) {
    if (store.isFull() || !store.insert(key, value)) {
      store.remove(key);
    }
  }
  const kept = pairs.filter(([key]) => store.contains(key)).length;
  const found = pairs.filter(([key]) => store.get(key) !== undefined).length;
  const rest = kept + found + store.room() + store.limit();
  const keys = pairs.map(([key]) => key);
  return total(store, keys) + (largest(store, keys) ?? 0) + rest;
}
