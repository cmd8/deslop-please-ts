import { inModelOrder } from "../model/index.ts";
import type { Item, Model, Reference, TreeNode } from "../model/index.ts";
import { circles } from "./components.ts";

export { circles } from "./components.ts";

export interface Thing {
  readonly item: Item;
  readonly home: TreeNode;
}

export type Tangle = readonly Thing[];

export interface Use {
  readonly reference: Reference;
  readonly user: Thing | undefined;
  readonly item: Item;
  readonly through: Item | undefined;
  readonly onlyReadsValue: boolean;
}

export interface Graph {
  readonly things: readonly Thing[];
  readonly thingOf: ReadonlyMap<Item, Thing>;
  readonly uses: readonly Use[];
  readonly tangles: readonly Tangle[];
  readonly tangleOf: ReadonlyMap<Thing, Tangle>;
  readonly itemOrder: (a: Item, b: Item) => number;
  readonly thingOrder: (a: Thing, b: Thing) => number;
}

export function buildGraph(model: Model): Graph {
  const { things, thingOf } = thingsOf(model);
  const uses = usesThroughWrappers(model, thingOf);
  const knows = new Map<Thing, Thing[]>();
  for (const usage of uses) {
    const used = thingOf.get(usage.item);
    if (usage.user !== undefined && used !== undefined && usage.user !== used) {
      const known = knows.get(usage.user) ?? [];
      knows.set(usage.user, known);
      known.push(used);
    }
  }
  const tangles = circles(things, knows);
  const tangleOf = new Map<Thing, Tangle>();
  for (const tangle of tangles) {
    for (const member of tangle) {
      tangleOf.set(member, tangle);
    }
  }
  return {
    things,
    thingOf,
    uses,
    tangles,
    tangleOf,
    itemOrder: inModelOrder(model.items),
    thingOrder: inModelOrder(things),
  };
}

function thingsOf(model: Model): { things: Thing[]; thingOf: Map<Item, Thing> } {
  const counted = (item: Item): boolean => !model.tree.isTest(item.owner) && !(item.file?.test ?? false);
  const things: Thing[] = [];
  const ofRoot = new Map<Item, Thing>();
  const thingOf = new Map<Item, Thing>();
  for (const item of model.items) {
    let root = item;
    for (let parent = root.parent; parent !== undefined; parent = root.parent) {
      root = parent;
    }
    const isThing = root.kind === "type" || root.kind === "function" || root.kind === "constant";
    if (!isThing || !counted(item) || !counted(root)) {
      continue;
    }
    let thing = ofRoot.get(root);
    if (thing === undefined) {
      thing = { item: root, home: root.owner };
      things.push(thing);
      ofRoot.set(root, thing);
    }
    thingOf.set(item, thing);
  }
  return { things, thingOf };
}

function usesThroughWrappers(model: Model, thingOf: ReadonlyMap<Item, Thing>): Use[] {
  const isWrapper = (item: Item): boolean => model.wrappers.has(item);
  const uses: Use[] = [];
  for (const reference of model.references) {
    if (reference.test || (reference.holder !== undefined && isWrapper(reference.holder))) {
      continue;
    }
    const user = reference.holder === undefined ? undefined : thingOf.get(reference.holder);
    const through = isWrapper(reference.item) ? reference.item : undefined;
    for (const { item, onlyReadsValue } of behind(model, reference)) {
      if (thingOf.has(item)) {
        uses.push({ reference, user, item, through, onlyReadsValue });
      }
    }
  }
  return uses;
}

interface UsedItem {
  readonly item: Item;
  readonly onlyReadsValue: boolean;
}

function behind(model: Model, reference: Reference, at: Item = reference.item): UsedItem[] {
  const wrapper = model.wrappers.get(at);
  if (wrapper === undefined) {
    return [{ item: at, onlyReadsValue: at === reference.item && reference.onlyReadsValue }];
  }
  const onlyRead = (field: Item): UsedItem => ({ item: field, onlyReadsValue: true });
  switch (wrapper.kind) {
    case "forwarder":
      return [...wrapper.fieldsCalledOn.map(onlyRead), ...behind(model, reference, wrapper.target)];
    case "accessor":
      return [
        ...wrapper.lent.map((field) => ({ item: field, onlyReadsValue: reference.onlyReadsValue })),
        ...wrapper.copied.map(onlyRead),
      ];
  }
}
