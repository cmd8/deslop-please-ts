import { idFromIndex } from "../id.ts";
import { fileOf, itemOf } from "../model/index.ts";
import type { ItemId, Model, NodeId, Reference } from "../model/index.ts";
import { circles } from "./components.ts";

export { circles } from "./components.ts";

declare const thingIdBrand: unique symbol;
export type ThingId = number & { readonly [thingIdBrand]: true };

declare const tangleIdBrand: unique symbol;
export type TangleId = number & { readonly [tangleIdBrand]: true };

export interface Thing {
  readonly item: ItemId;
  readonly home: NodeId;
}

export interface Use {
  readonly reference: number;
  readonly user: ThingId | undefined;
  readonly item: ItemId;
  readonly through: ItemId | undefined;
  readonly onlyReadsValue: boolean;
}

export interface Graph {
  readonly things: readonly Thing[];
  readonly thingOf: readonly (ThingId | undefined)[];
  readonly uses: readonly Use[];
  readonly tangles: readonly (readonly ThingId[])[];
  readonly tangleOf: readonly (TangleId | undefined)[];
}

export function buildGraph(model: Model): Graph {
  const { things, thingOf } = thingsOf(model);
  const uses = usesThroughWrappers(model, thingOf);
  const knows: number[][] = things.map(() => []);
  for (const usage of uses) {
    const used = thingOf[usage.item];
    if (usage.user !== undefined && used !== undefined && usage.user !== used) {
      knows[usage.user]?.push(used);
    }
  }
  const tangles = circles(knows).map((members) => members.map((member) => idFromIndex<ThingId>(member)));
  const tangleOf = new Array<TangleId | undefined>(things.length).fill(undefined);
  tangles.forEach((members, index) => {
    for (const member of members) {
      tangleOf[member] = idFromIndex<TangleId>(index);
    }
  });
  return { things, thingOf, uses, tangles, tangleOf };
}

export function thingAt(graph: Graph, id: ThingId): Thing {
  const thing = graph.things[id];
  if (thing === undefined) {
    throw new RangeError(`no thing ${id} in the graph`);
  }
  return thing;
}

function thingsOf(model: Model): { things: Thing[]; thingOf: (ThingId | undefined)[] } {
  const counted = (id: ItemId): boolean => {
    const item = itemOf(model, id);
    return !model.tree.isTest(item.owner) && (item.file === undefined || !fileOf(model, item.file).test);
  };
  const things: Thing[] = [];
  const ofRoot = new Map<ItemId, ThingId>();
  const thingOf = new Array<ThingId | undefined>(model.items.length).fill(undefined);
  for (let index = 0; index < model.items.length; index += 1) {
    const id = idFromIndex<ItemId>(index);
    let root = id;
    for (let parent = itemOf(model, root).parent; parent !== undefined; parent = itemOf(model, root).parent) {
      root = parent;
    }
    const item = itemOf(model, root);
    const isThing = item.kind === "type" || item.kind === "function" || item.kind === "constant";
    if (!isThing || !counted(id) || !counted(root)) {
      continue;
    }
    let thing = ofRoot.get(root);
    if (thing === undefined) {
      things.push({ item: root, home: item.owner });
      thing = idFromIndex<ThingId>(things.length - 1);
      ofRoot.set(root, thing);
    }
    thingOf[index] = thing;
  }
  return { things, thingOf };
}

function usesThroughWrappers(model: Model, thingOf: readonly (ThingId | undefined)[]): Use[] {
  const isWrapper = (id: ItemId): boolean => model.wrappers.has(id);
  const uses: Use[] = [];
  model.references.forEach((reference, index) => {
    if (reference.test || (reference.holder !== undefined && isWrapper(reference.holder))) {
      return;
    }
    const user = reference.holder === undefined ? undefined : thingOf[reference.holder];
    const through = isWrapper(reference.item) ? reference.item : undefined;
    for (const { item, onlyReadsValue } of behind(model, reference)) {
      if (thingOf[item] !== undefined) {
        uses.push({ reference: index, user, item, through, onlyReadsValue });
      }
    }
  });
  return uses;
}

interface UsedItem {
  readonly item: ItemId;
  readonly onlyReadsValue: boolean;
}

function behind(model: Model, reference: Reference, at: ItemId = reference.item): UsedItem[] {
  const wrapper = model.wrappers.get(at);
  if (wrapper === undefined) {
    return [{ item: at, onlyReadsValue: at === reference.item && reference.onlyReadsValue }];
  }
  const onlyRead = (field: ItemId): UsedItem => ({ item: field, onlyReadsValue: true });
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
