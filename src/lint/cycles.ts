import { circles } from "../graph/index.ts";
import { inModelOrder } from "../model/index.ts";
import type { Model, Tree, TreeNode } from "../model/index.ts";
import { compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { Tie, circleReport, counted, inScope, listed, type ItemOrder } from "./reporting.ts";

interface ModuleTie {
  readonly user: TreeNode;
  readonly used: TreeNode;
  readonly tie: Tie;
}

export function moduleCycles(model: Model, scope: TreeNode | undefined): Diagnostic[] {
  const tree = model.tree;
  const order = inModelOrder(model.items);
  const inTreeOrder = (a: TreeNode, b: TreeNode): number => tree.compare(a, b);
  const tiesByParent = new Map<TreeNode, Map<TreeNode, Map<TreeNode, ModuleTie>>>();
  for (const reference of model.references.filter((reference) => !reference.test)) {
    const item = reference.item;
    const test = tree.isTest(item.owner) || (item.file?.test ?? false);
    const tied = test ? undefined : siblings(tree, reference.from, item.owner);
    if (tied === undefined) {
      continue;
    }
    const ties = tiesByParent.get(tied.parent) ?? new Map<TreeNode, Map<TreeNode, ModuleTie>>();
    tiesByParent.set(tied.parent, ties);
    const fromUser = ties.get(tied.user) ?? new Map<TreeNode, ModuleTie>();
    ties.set(tied.user, fromUser);
    const moduleTie = fromUser.get(tied.used) ?? { user: tied.user, used: tied.used, tie: new Tie() };
    fromUser.set(tied.used, moduleTie);
    moduleTie.tie.add(reference.item, reference, tied.user);
  }
  const diagnostics: Diagnostic[] = [];
  for (const [parent, byUser] of [...tiesByParent].sort(([a], [b]) => inTreeOrder(a, b))) {
    const ties = [...byUser.values()]
      .flatMap((byUsed) => [...byUsed.values()])
      .sort((a, b) => inTreeOrder(a.user, b.user) || inTreeOrder(a.used, b.used));
    const children = [...new Set(ties.flatMap(({ user, used }) => [user, used]))].sort(inTreeOrder);
    const uses = new Map<TreeNode, TreeNode[]>();
    for (const { user, used } of ties) {
      const targets = uses.get(user) ?? [];
      uses.set(user, targets);
      targets.push(used);
    }
    for (const members of circles(children, uses)) {
      if (members.some((member) => inScope(tree, scope, member))) {
        diagnostics.push(diagnostic(model, order, parent, members, ties));
      }
    }
  }
  return diagnostics;
}

interface Siblings {
  readonly parent: TreeNode;
  readonly user: TreeNode;
  readonly used: TreeNode;
}

function siblings(tree: Tree, a: TreeNode, b: TreeNode): Siblings | undefined {
  const parent = tree.commonAncestor(a, b);
  if (parent === a || parent === b || parent.kind === "workspace") {
    return undefined;
  }
  const child = (of: TreeNode): TreeNode | undefined =>
    tree.selfThenAncestors(of).find((node) => tree.parent(node) === parent);
  const user = child(a);
  const used = child(b);
  return user === undefined || used === undefined ? undefined : { parent, user, used };
}

function diagnostic(
  model: Model,
  order: ItemOrder,
  parent: TreeNode,
  members: readonly TreeNode[],
  ties: readonly ModuleTie[],
): Diagnostic {
  const tree = model.tree;
  const name = (module: TreeNode): string => module.name;
  const names = members.map(name).sort(compareText);
  const keys = members.map((member) => tree.display(member)).sort(compareText);
  const inside = ties
    .filter(({ user, used }) => members.includes(user) && members.includes(used))
    .map(({ user, used, tie }) => ({ user: name(user), used: name(used), tie }));
  const report = circleReport(order, "uses", "module", members.length, inside);
  return {
    lint: "module-cycle",
    key: keys.join(","),
    message: `${counted(members.length, "module")} in \`${tree.display(parent)}\` use each other in a circle`,
    location: report.location,
    notes: [`members: ${listed(names)}`, ...report.notes],
    picture: report.picture,
  };
}
