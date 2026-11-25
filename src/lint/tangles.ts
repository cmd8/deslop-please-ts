import { referenceOf, thingAt } from "../graph/index.ts";
import type { Graph, ThingId } from "../graph/index.ts";
import type { Model, NodeId } from "../model/index.ts";
import { HELD_IN_MIND, compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { Tie, circleReport, counted, fullName, inScope, listed } from "./reporting.ts";

interface ThingTie {
  readonly user: ThingId;
  readonly used: ThingId;
  readonly tie: Tie;
}

interface Written {
  readonly members: readonly ThingId[];
  readonly modules: Set<NodeId>;
  readonly ties: Map<string, ThingTie>;
}

export function tangles(model: Model, graph: Graph, scope: NodeId | undefined): Diagnostic[] {
  const written: Written[] = graph.tangles.map((members) => ({
    members,
    modules: new Set(members.map((member) => thingAt(graph, member).home)),
    ties: new Map(),
  }));
  for (const usage of graph.uses) {
    const user = usage.user;
    const used = graph.thingOf[usage.item];
    if (user === undefined || used === undefined || user === used) {
      continue;
    }
    const tangle = graph.tangleOf[user];
    const into = tangle === undefined || graph.tangleOf[used] !== tangle ? undefined : written[tangle];
    if (into === undefined) {
      continue;
    }
    const reference = referenceOf(model, usage);
    into.modules.add(reference.from);
    const pair = `${user},${used}`;
    const thingTie = into.ties.get(pair) ?? { user, used, tie: new Tie() };
    into.ties.set(pair, thingTie);
    thingTie.tie.add(model, usage.item, reference, reference.from);
  }
  const diagnostics: Diagnostic[] = [];
  for (const tangle of written) {
    const concerned = tangle.members.some((member) => inScope(model.tree, scope, thingAt(graph, member).home));
    if (concerned && (tangle.modules.size > 1 || tangle.members.length > HELD_IN_MIND)) {
      diagnostics.push(diagnostic(model, graph, tangle));
    }
  }
  return diagnostics;
}

function diagnostic(model: Model, graph: Graph, written: Written): Diagnostic {
  const members = written.members;
  const names = members.map((member) => fullName(model, graph, member)).sort(compareText);
  const ties = [...written.ties.values()]
    .sort((a, b) => a.user - b.user || a.used - b.used)
    .map(({ user, used, tie }) => ({
      user: fullName(model, graph, user),
      used: fullName(model, graph, used),
      tie,
    }));
  const report = circleReport(model, "knows", "thing", members.length, ties);
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
