import { referenceOf, thingAt } from "../graph/index.ts";
import type { Graph, ThingId, Use } from "../graph/index.ts";
import { fileOf, itemOf } from "../model/index.ts";
import { idFromIndex } from "../id.ts";
import type { ItemId, Model, NodeId } from "../model/index.ts";
import { HELD_IN_MIND, compareLocations, compareText } from "./diagnostic.ts";
import type { Diagnostic, Location, PlacesInModule } from "./diagnostic.ts";
import { clickable, counted, inScope, listed, withoutGenerics } from "./reporting.ts";

type OutsideUses = ReadonlyMap<ItemId, readonly Use[]>;

export function fieldLeaks(model: Model, graph: Graph, scope: NodeId | undefined): Diagnostic[] {
  const fieldsOfThing = new Map<ThingId, ItemId[]>();
  model.items.forEach((item, index) => {
    const ofType = item.parent !== undefined && itemOf(model, item.parent).kind === "type";
    const thing = graph.thingOf[index];
    if (item.kind === "field" && ofType && thing !== undefined) {
      const fields = fieldsOfThing.get(thing) ?? [];
      fieldsOfThing.set(thing, fields);
      fields.push(idFromIndex<ItemId>(index));
    }
  });
  const outside = new Map<ItemId, Use[]>();
  const working = new Set<ThingId>();
  for (const usage of graph.uses) {
    const owner = itemOf(model, usage.item).kind === "field" ? graph.thingOf[usage.item] : undefined;
    if (owner === undefined) {
      continue;
    }
    const tangle = graph.tangleOf[owner];
    const user = usage.user;
    const insider = user !== undefined && (user === owner || (tangle !== undefined && graph.tangleOf[user] === tangle));
    if (!insider) {
      const uses = outside.get(usage.item) ?? [];
      outside.set(usage.item, uses);
      uses.push(usage);
    } else if (user === owner && worksOnFields(model, usage)) {
      working.add(owner);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const [thing, fields] of [...fieldsOfThing].sort(([a], [b]) => a - b)) {
    const kept = fields.some((field) => !outside.has(field));
    if (!kept || !working.has(thing)) {
      continue;
    }
    for (const field of fields) {
      const uses = (outside.get(field) ?? []).filter((usage) => !usage.onlyReadsValue);
      if (uses.length === 0) {
        continue;
      }
      const home = thingAt(graph, thing).home;
      const concerned =
        inScope(model.tree, scope, home) ||
        uses.some((usage) => inScope(model.tree, scope, referenceOf(model, usage).from));
      if (concerned) {
        diagnostics.push(diagnostic(model, graph, thing, field, uses, others(model, field, fields, outside)));
      }
    }
  }
  return diagnostics;
}

function worksOnFields(model: Model, usage: Use): boolean {
  const holder = referenceOf(model, usage).holder;
  if (holder === undefined) {
    return false;
  }
  const item = itemOf(model, holder);
  return item.kind === "function" && item.takesThis;
}

function others(model: Model, field: ItemId, fields: readonly ItemId[], outside: OutsideUses): string[] {
  const known: string[] = [];
  const kept: string[] = [];
  for (const other of fields.filter((other) => other !== field)) {
    const uses = outside.get(other);
    if (uses === undefined) {
      kept.push(bareName(model, other));
    } else if (uses.some((usage) => !usage.onlyReadsValue)) {
      known.push(bareName(model, other));
    }
  }
  const lines: string[] = [];
  if (known.length > 0) {
    lines.push(`also known outside: ${listed(known)}`);
  }
  if (kept.length > 0) {
    lines.push(`kept: ${listed(kept)}`);
  }
  return lines;
}

function bareName(model: Model, field: ItemId): string {
  const name = itemOf(model, field).name;
  return name.slice(name.lastIndexOf(".") + 1);
}

interface Site {
  readonly at: Location;
  readonly user: string;
}

function diagnostic(
  model: Model,
  graph: Graph,
  thing: ThingId,
  field: ItemId,
  uses: readonly Use[],
  others: readonly string[],
): Diagnostic {
  const tree = model.tree;
  const sites = new Map<string, Site>();
  const places = new Map<NodeId, Set<string>>();
  for (const usage of uses) {
    const reference = referenceOf(model, usage);
    const holder = reference.holder === undefined ? undefined : itemOf(model, reference.holder);
    const user =
      holder === undefined ? tree.display(reference.from) : `${tree.display(holder.owner)}:${withoutGenerics(holder.name)}`;
    const through =
      usage.through === undefined ? "" : `, through \`${withoutGenerics(itemOf(model, usage.through).name)}\``;
    const at: Location = { file: fileOf(model, reference.file).path, line: reference.line };
    const key = clickable(at);
    const inModule = places.get(reference.from) ?? new Set<string>();
    places.set(reference.from, inModule);
    inModule.add(key);
    if (!sites.has(key)) {
      sites.set(key, { at, user: `\`${user}\`${through}` });
    }
  }
  const owner = thingAt(graph, thing);
  const typeName = withoutGenerics(itemOf(model, owner.item).name);
  const fieldName = itemOf(model, field).name;
  const sorted = [...sites.values()].sort((a, b) => compareLocations(a.at, b.at));
  const notes = sorted.slice(0, HELD_IN_MIND).map(({ at, user }) => `${clickable(at)}: ${user}`);
  if (sorted.length > HELD_IN_MIND) {
    notes.push(`and ${counted(sorted.length - HELD_IN_MIND, "more place")}`);
  }
  const modules: PlacesInModule[] = [...places]
    .map(([module, inModule]) => ({ places: inModule.size, module: tree.display(module) }))
    .sort((a, b) => b.places - a.places || compareText(a.module, b.module));
  const moduleCount = modules.length;
  const more = modules.splice(HELD_IN_MIND);
  if (more.length > 0) {
    const placesInMore = more.reduce((sum, { places }) => sum + places, 0);
    modules.push({ places: placesInMore, module: `in ${counted(more.length, "more module")}` });
  }
  const home = tree.display(owner.home);
  return {
    lint: "field-leak",
    key: `${home}:${fieldName}`,
    message: `\`${fieldName}\` is known outside \`${typeName}\`: ${counted(sorted.length, "place")} in ${counted(moduleCount, "module")}`,
    location: sorted[0]?.at,
    notes,
    picture: { kind: "spread", owner: `${home}:${typeName}`, field: bareName(model, field), modules, others },
  };
}
