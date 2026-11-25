import { circles } from "../graph/index.ts";
import { fileOf, itemOf } from "../model/index.ts";
import type { Model, NodeId, Tree } from "../model/index.ts";
import { compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { Tie, circleReport, counted, inScope, listed } from "./reporting.ts";

interface ModuleTie {
  readonly user: NodeId;
  readonly used: NodeId;
  readonly tie: Tie;
}

export function moduleCycles(model: Model, scope: NodeId | undefined): Diagnostic[] {
  const tree = model.tree;
  const tiesByParent = new Map<NodeId, Map<string, ModuleTie>>();
  for (const reference of model.references.filter((reference) => !reference.test)) {
    const item = itemOf(model, reference.item);
    const test = tree.isTest(item.owner) || (item.file !== undefined && fileOf(model, item.file).test);
    const tied = test ? undefined : siblings(tree, reference.from, item.owner);
    if (tied === undefined) {
      continue;
    }
    const ties = tiesByParent.get(tied.parent) ?? new Map<string, ModuleTie>();
    tiesByParent.set(tied.parent, ties);
    const pair = `${tied.user},${tied.used}`;
    const moduleTie = ties.get(pair) ?? { user: tied.user, used: tied.used, tie: new Tie() };
    ties.set(pair, moduleTie);
    moduleTie.tie.add(model, reference.item, reference, tied.user);
  }
  const diagnostics: Diagnostic[] = [];
  for (const [parent, unsorted] of [...tiesByParent].sort(([a], [b]) => a - b)) {
    const ties = [...unsorted.values()].sort((a, b) => a.user - b.user || a.used - b.used);
    const children = [...new Set(ties.flatMap(({ user, used }) => [user, used]))].sort((a, b) => a - b);
    const uses: number[][] = children.map(() => []);
    for (const { user, used } of ties) {
      uses[children.indexOf(user)]?.push(children.indexOf(used));
    }
    for (const circle of circles(uses)) {
      const members = children.filter((_, at) => circle.includes(at));
      if (members.some((member) => inScope(tree, scope, member))) {
        diagnostics.push(diagnostic(model, parent, members, ties));
      }
    }
  }
  return diagnostics;
}

interface Siblings {
  readonly parent: NodeId;
  readonly user: NodeId;
  readonly used: NodeId;
}

function siblings(tree: Tree, a: NodeId, b: NodeId): Siblings | undefined {
  const parent = tree.commonAncestor(a, b);
  if (parent === a || parent === b || tree.node(parent).kind === "workspace") {
    return undefined;
  }
  const child = (of: NodeId): NodeId | undefined =>
    tree.selfThenAncestors(of).find((node) => tree.parent(node) === parent);
  const user = child(a);
  const used = child(b);
  return user === undefined || used === undefined ? undefined : { parent, user, used };
}

function diagnostic(model: Model, parent: NodeId, members: readonly NodeId[], ties: readonly ModuleTie[]): Diagnostic {
  const tree = model.tree;
  const name = (module: NodeId): string => tree.node(module).name;
  const names = members.map(name).sort(compareText);
  const keys = members.map((member) => tree.display(member)).sort(compareText);
  const inside = ties
    .filter(({ user, used }) => members.includes(user) && members.includes(used))
    .map(({ user, used, tie }) => ({ user: name(user), used: name(used), tie }));
  const report = circleReport(model, "uses", "module", members.length, inside);
  return {
    lint: "module-cycle",
    key: keys.join(","),
    message: `${counted(members.length, "module")} in \`${tree.display(parent)}\` use each other in a circle`,
    location: report.location,
    notes: [`members: ${listed(names)}`, ...report.notes],
    picture: report.picture,
  };
}
