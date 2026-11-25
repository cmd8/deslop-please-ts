import * as store from "./store/index.ts";

export function run(pairs: ReadonlyArray<readonly [key: number, value: number]>): number {
  const held = new store.Store(8);
  for (const [key, value] of pairs) {
    if (store.isFull(held) || !store.insert(held, key, value)) {
      store.remove(held, key);
    }
  }
  const kept = pairs.filter(([key]) => store.contains(held, key)).length;
  const found = pairs.filter(([key]) => store.get(held, key) !== undefined).length;
  const rest = kept + found + store.room(held) + held.limit();
  return store.total(held) + (store.largest(held) ?? 0) + rest;
}
