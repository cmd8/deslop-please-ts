import type { Graph, Thing } from "../graph/index.ts";
import type { Item, Model, Tree, TreeNode } from "../model/index.ts";
import { HELD_IN_MIND, compareText, compareTextLists } from "./diagnostic.ts";
import type { Diagnostic, LongList } from "./diagnostic.ts";
import { counted, inScope, listed, moduleLocation, withoutGenerics } from "./reporting.ts";

const HIDDEN_PER_SHOWN_AT_BREAK_EVEN = 1;

type TypesKnown = ReadonlyMap<Thing, ReadonlySet<Thing>>;

interface ThingList {
  readonly thing: string;
  readonly functions: readonly string[];
}

export function shallowModules(model: Model, graph: Graph, scope: TreeNode | undefined): Diagnostic[] {
  const tree = model.tree;
  const judged = judgedModules(tree);
  const home = (item: Item): TreeNode | undefined => graph.thingOf.get(item)?.home;
  const working = (item: Item): boolean =>
    item.kind === "function" && !item.implementsInheritedMember && !model.wrappers.has(item);
  const total = new Map<TreeNode, number>();
  for (const item of model.items) {
    const at = working(item) ? home(item) : undefined;
    if (at === undefined) {
      continue;
    }
    for (const module of modulesAround(tree, at).filter((module) => judged.has(module))) {
      total.set(module, (total.get(module) ?? 0) + 1);
    }
  }
  const shown = new Map<TreeNode, Set<Item>>();
  for (const usage of graph.uses) {
    const at = working(usage.item) ? home(usage.item) : undefined;
    if (at === undefined) {
      continue;
    }
    const user = usage.user === undefined ? usage.reference.from : usage.user.home;
    for (const module of modulesAround(tree, at)) {
      if (within(tree, user, module)) {
        break;
      }
      if (judged.has(module)) {
        const functions = shown.get(module) ?? new Set<Item>();
        shown.set(module, functions);
        functions.add(usage.item);
      }
    }
  }
  const known = typesKnown(graph);
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

function typesKnown(graph: Graph): TypesKnown {
  const known = new Map<Thing, Set<Thing>>();
  for (const usage of graph.uses) {
    const used = graph.thingOf.get(usage.item);
    if (usage.user !== undefined && used !== undefined && usage.user.item.kind === "function" && used.item.kind === "type") {
      const types = known.get(usage.user) ?? new Set<Thing>();
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
  module: TreeNode,
  shown: ReadonlySet<Item>,
): ThingList[] {
  const name = (item: Item): string => withoutGenerics(item.name);
  const ofModule = (type: Thing): boolean => within(model.tree, type.home, module);
  const byThing = new Map<Thing, string[]>();
  for (const function_ of shown) {
    const thing = graph.thingOf.get(function_);
    if (thing === undefined) {
      continue;
    }
    const types = thing.item === function_ ? [...(known.get(thing) ?? [])].filter(ofModule) : [];
    for (const list of types.length > 0 ? types : [thing]) {
      const functions = byThing.get(list) ?? [];
      byThing.set(list, functions);
      functions.push(name(function_));
    }
  }
  return [...byThing]
    .sort(([a], [b]) => graph.thingOrder(a, b))
    .map(([thing, functions]) => ({ thing: name(thing.item), functions: functions.sort(compareText) }))
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

function judgedModules(tree: Tree): Set<TreeNode> {
  const nodes = tree.eachAfterItsParent();
  const parents = new Set<TreeNode>();
  for (const node of nodes) {
    const parent = tree.parent(node);
    if (parent !== undefined && !tree.isTest(node)) {
      parents.add(parent);
    }
  }
  return new Set(
    nodes.filter((node) => {
      if (tree.isTest(node)) {
        return false;
      }
      switch (node.kind) {
        case "package":
          return true;
        case "module":
          return parents.has(node);
        case "workspace":
          return false;
      }
    }),
  );
}

function modulesAround(tree: Tree, node: TreeNode): TreeNode[] {
  const package_ = tree.packageOf(node);
  const around: TreeNode[] = [];
  for (const at of tree.selfThenAncestors(node)) {
    if (tree.packageOf(at) !== package_ || at.kind === "workspace") {
      break;
    }
    around.push(at);
  }
  return around;
}

function within(tree: Tree, node: TreeNode, module: TreeNode): boolean {
  return tree.isWithin(node, module) && tree.packageOf(node) === tree.packageOf(module);
}
