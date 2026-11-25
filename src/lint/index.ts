import { buildGraph } from "../graph/index.ts";
import type { Model, NodeId } from "../model/index.ts";
import { moduleCycles } from "./cycles.ts";
import { compareLints, compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { layout } from "./layout.ts";
import { fieldLeaks } from "./leaks.ts";
import { shallowModules } from "./shallow.ts";
import { tangles } from "./tangles.ts";

export { HELD_IN_MIND, LINTS, compareLints, parseLint } from "./diagnostic.ts";
export type { Diagnostic, Lint, Location, LongList, Picture, PlacesInModule, Step } from "./diagnostic.ts";

export function check(model: Model, scope: NodeId | undefined): Diagnostic[] {
  const graph = buildGraph(model);
  return [
    ...moduleCycles(model, scope),
    ...tangles(model, graph, scope),
    ...fieldLeaks(model, graph, scope),
    ...shallowModules(model, graph, scope),
    ...layout(model, scope),
  ].sort((a, b) => compareLints(a.lint, b.lint) || compareText(a.key, b.key));
}

export function resolveNode(model: Model, query: string): NodeId | undefined {
  const tree = model.tree;
  return tree.eachAfterItsParent().find((id) => tree.node(id).kind !== "workspace" && tree.display(id) === query);
}
