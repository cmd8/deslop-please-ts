import type { Graph, Tangle, Thing } from "../graph/index.ts";
import type { Model, TreeNode } from "../model/index.ts";
import { HELD_IN_MIND, compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { Tie, circleReport, counted, fullName, inScope, listed } from "./reporting.ts";

interface ThingTie {
  readonly user: Thing;
  readonly used: Thing;
  readonly tie: Tie;
}

interface Written {
  readonly members: Tangle;
  readonly modules: Set<TreeNode>;
  readonly ties: Map<Thing, Map<Thing, ThingTie>>;
}

export function tangles(model: Model, graph: Graph, scope: TreeNode | undefined): Diagnostic[] {
  const written = new Map<Tangle, Written>(
    graph.tangles.map((members) => [
      members,
      { members, modules: new Set(members.map((member) => member.home)), ties: new Map() },
    ]),
  );
  for (const usage of graph.uses) {
    const user = usage.user;
    const used = graph.thingOf.get(usage.item);
    if (user === undefined || used === undefined || user === used) {
      continue;
    }
    const tangle = graph.tangleOf.get(user);
    const into = tangle === undefined || graph.tangleOf.get(used) !== tangle ? undefined : written.get(tangle);
    if (into === undefined) {
      continue;
    }
    const reference = usage.reference;
    into.modules.add(reference.from);
    const fromUser = into.ties.get(user) ?? new Map<Thing, ThingTie>();
    into.ties.set(user, fromUser);
    const thingTie = fromUser.get(used) ?? { user, used, tie: new Tie() };
    fromUser.set(used, thingTie);
    thingTie.tie.add(usage.item, reference, reference.from);
  }
  const diagnostics: Diagnostic[] = [];
  for (const tangle of written.values()) {
    const concerned = tangle.members.some((member) => inScope(model.tree, scope, member.home));
    if (concerned && (tangle.modules.size > 1 || tangle.members.length > HELD_IN_MIND)) {
      diagnostics.push(diagnostic(model, graph, tangle));
    }
  }
  return diagnostics;
}

function diagnostic(model: Model, graph: Graph, written: Written): Diagnostic {
  const members = written.members;
  const names = members.map((member) => fullName(model.tree, member)).sort(compareText);
  const ties = [...written.ties.values()]
    .flatMap((byUsed) => [...byUsed.values()])
    .sort((a, b) => graph.thingOrder(a.user, b.user) || graph.thingOrder(a.used, b.used))
    .map(({ user, used, tie }) => ({
      user: fullName(model.tree, user),
      used: fullName(model.tree, used),
      tie,
    }));
  const report = circleReport(graph.itemOrder, "knows", "thing", members.length, ties);
  const notes = [`members: ${listed(names)}`];
  const modules = [...written.modules];
  if (modules.length > 1) {
    const displayed = modules.map((module) => model.tree.display(module)).sort(compareText);
    notes.push(`written in: ${listed(displayed)}`);
  }
  const [only, ...others] = modules;
  const count = names.length;
  const message =
    only !== undefined && others.length === 0
      ? `${count} things know each other in a circle, all in \`${model.tree.display(only)}\``
      : `${count} things know each other in a circle, across ${counted(modules.length, "module")}`;
  return {
    lint: "tangle",
    key: names.join(","),
    message,
    location: report.location,
    notes: [...notes, ...report.notes],
    picture: report.picture,
  };
}
