import { referenceOf, thingAt } from "../graph/index.ts";
import type { Graph, ThingId } from "../graph/index.ts";
import { idFromIndex } from "../id.ts";
import { itemOf } from "../model/index.ts";
import type { ItemId, ItemKind, Model, NodeId, Tree } from "../model/index.ts";
import { HELD_IN_MIND, compareText, compareTextLists } from "./diagnostic.ts";
import type { Diagnostic, LongList } from "./diagnostic.ts";
import { counted, inScope, listed, moduleLocation, withoutGenerics } from "./reporting.ts";

const HIDDEN_PER_SHOWN_AT_BREAK_EVEN = 1;

type TypesKnown = ReadonlyMap<ThingId, ReadonlySet<ThingId>>;

interface ThingList {
  readonly thing: string;
  readonly functions: readonly string[];
}

export function shallowModules(model: Model, graph: Graph, scope: NodeId | undefined): Diagnostic[] {
  const tree = model.tree;
  const judged = judgedModules(tree);
  const home = (item: ItemId): NodeId | undefined => {
    const thing = graph.thingOf[item];
    return thing === undefined ? undefined : thingAt(graph, thing).home;
  };
  const working = (item: ItemId): boolean => {
    const function_ = itemOf(model, item);
    return function_.kind === "function" && !function_.implementsInheritedMember && !model.wrappers.has(item);
  };
  const total = new Map<NodeId, number>();
  for (let index = 0; index < model.items.length; index += 1) {
    const item = idFromIndex<ItemId>(index);
    const at = working(item) ? home(item) : undefined;
    if (at === undefined) {
      continue;
    }
    for (const module of modulesAround(tree, at).filter((module) => judged.has(module))) {
      total.set(module, (total.get(module) ?? 0) + 1);
    }
  }
  const shown = new Map<NodeId, Set<ItemId>>();
  for (const usage of graph.uses) {
    const at = working(usage.item) ? home(usage.item) : undefined;
    if (at === undefined) {
      continue;
    }
    const user = usage.user === undefined ? referenceOf(model, usage).from : thingAt(graph, usage.user).home;
    for (const module of modulesAround(tree, at)) {
      if (within(tree, user, module)) {
        break;
      }
      if (judged.has(module)) {
        const functions = shown.get(module) ?? new Set<ItemId>();
        shown.set(module, functions);
        functions.add(usage.item);
      }
    }
  }
  const known = typesKnown(model, graph);
  const diagnostics: Diagnostic[] = [];
  for (const module of judged) {
    const functions = shown.get(module);
    if (functions === undefined) {
      continue;
    }
    const all = total.get(module) ?? 0;
    const hidden = Math.max(0, all - functions.size);
    const { notes, long } = tooLong(lists(model, graph, known, module, functions));
    const shallow =
      functions.size > HELD_IN_MIND &&
      notes.length > 0 &&
      hidden <= functions.size * HIDDEN_PER_SHOWN_AT_BREAK_EVEN;
    if (shallow && inScope(tree, scope, module)) {
      const name = tree.display(module);
      diagnostics.push({
        lint: "shallow-module",
        key: name,
        message: `\`${name}\` is shallow: it shows ${functions.size} of its ${counted(all, "function")}`,
        location: moduleLocation(model, module),
        notes,
        picture: { kind: "lists", shown: functions.size, hidden, lists: long },
      });
    }
  }
  return diagnostics;
}

function typesKnown(model: Model, graph: Graph): TypesKnown {
  const kind = (thing: ThingId): ItemKind => itemOf(model, thingAt(graph, thing).item).kind;
  const known = new Map<ThingId, Set<ThingId>>();
  for (const usage of graph.uses) {
    const used = graph.thingOf[usage.item];
    if (usage.user !== undefined && used !== undefined && kind(usage.user) === "function" && kind(used) === "type") {
      const types = known.get(usage.user) ?? new Set<ThingId>();
      known.set(usage.user, types);
      types.add(used);
    }
  }
  return known;
}

function lists(
  model: Model,
  graph: Graph,
  known: TypesKnown,
  module: NodeId,
  shown: ReadonlySet<ItemId>,
): ThingList[] {
  const name = (item: ItemId): string => withoutGenerics(itemOf(model, item).name);
  const ofModule = (type: ThingId): boolean => within(model.tree, thingAt(graph, type).home, module);
  const byThing = new Map<ThingId, string[]>();
  for (const function_ of shown) {
    const thing = graph.thingOf[function_];
    if (thing === undefined) {
      continue;
    }
    const types = thingAt(graph, thing).item === function_ ? [...(known.get(thing) ?? [])].filter(ofModule) : [];
    for (const list of types.length > 0 ? types : [thing]) {
      const functions = byThing.get(list) ?? [];
      byThing.set(list, functions);
      functions.push(name(function_));
    }
  }
  return [...byThing]
    .sort(([a], [b]) => a - b)
    .map(([thing, functions]) => ({ thing: name(thingAt(graph, thing).item), functions: functions.sort(compareText) }))
    .sort((a, b) => compareText(a.thing, b.thing) || compareTextLists(a.functions, b.functions))
    .sort((a, b) => b.functions.length - a.functions.length);
}

function tooLong(lists: readonly ThingList[]): { notes: string[]; long: LongList[] } {
  const notes: string[] = [];
  const long: LongList[] = [];
  if (lists.length > HELD_IN_MIND) {
    const names = lists.map(({ thing }) => thing);
    notes.push(`shows ${counted(lists.length, "thing")}: ${listed(names)}`);
    long.push({ name: "things", length: lists.length });
  }
  for (const { thing, functions } of lists) {
    if (functions.length > HELD_IN_MIND) {
      notes.push(`\`${thing}\` shows ${counted(functions.length, "function")}: ${listed(functions)}`);
      long.push({ name: thing, length: functions.length });
    }
  }
  return { notes, long };
}

function judgedModules(tree: Tree): Set<NodeId> {
  const nodes = tree.eachAfterItsParent();
  const parents = new Set<NodeId>();
  for (const id of nodes) {
    const parent = tree.parent(id);
    if (parent !== undefined && !tree.isTest(id)) {
      parents.add(parent);
    }
  }
  return new Set(
    nodes.filter((id) => {
      if (tree.isTest(id)) {
        return false;
      }
      switch (tree.node(id).kind) {
        case "package":
          return true;
        case "module":
          return parents.has(id);
        case "workspace":
          return false;
      }
    }),
  );
}

function modulesAround(tree: Tree, node: NodeId): NodeId[] {
  const package_ = tree.packageOf(node);
  const around: NodeId[] = [];
  for (const at of tree.selfThenAncestors(node)) {
    if (tree.packageOf(at) !== package_ || tree.node(at).kind === "workspace") {
      break;
    }
    around.push(at);
  }
  return around;
}

function within(tree: Tree, node: NodeId, module: NodeId): boolean {
  return tree.isWithin(node, module) && tree.packageOf(node) === tree.packageOf(module);
}
