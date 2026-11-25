import { Store } from "./store/index.ts";

export function run(pairs: ReadonlyArray<readonly [key: number, value: number]>): number {
  const store = new Store(8);
  const kept = store.load(pairs);
  return store.summary() + kept;
}
