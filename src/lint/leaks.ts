import type { Graph, Thing, Use } from "../graph/index.ts";
import type { Item, Model, TreeNode } from "../model/index.ts";
import { HELD_IN_MIND, compareLocations, compareText } from "./diagnostic.ts";
import type { Diagnostic, Location, PlacesInModule } from "./diagnostic.ts";
import { clickable, counted, inScope, listed, withoutGenerics } from "./reporting.ts";

type OutsideUses = ReadonlyMap<Item, readonly Use[]>;

export function fieldLeaks(model: Model, graph: Graph, scope: TreeNode | undefined): Diagnostic[] {
  const fieldsOfThing = new Map<Thing, Item[]>();
  for (const item of model.items) {
    const ofType = item.parent?.kind === "type";
    const thing = graph.thingOf.get(item);
    if (item.kind === "field" && ofType && thing !== undefined) {
      const fields = fieldsOfThing.get(thing) ?? [];
      fieldsOfThing.set(thing, fields);
      fields.push(item);
    }
  }
  const outside = new Map<Item, Use[]>();
  const working = new Set<Thing>();
  for (const usage of graph.uses) {
    const owner = usage.item.kind === "field" ? graph.thingOf.get(usage.item) : undefined;
    if (owner === undefined) {
      continue;
    }
    const tangle = graph.tangleOf.get(owner);
    const user = usage.user;
    const insider = user !== undefined && (user === owner || (tangle !== undefined && graph.tangleOf.get(user) === tangle));
    if (!insider) {
      const uses = outside.get(usage.item) ?? [];
      outside.set(usage.item, uses);
      uses.push(usage);
    } else if (user === owner && worksOnFields(usage)) {
      working.add(owner);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const [thing, fields] of [...fieldsOfThing].sort(([a], [b]) => graph.thingOrder(a, b))) {
    const kept = fields.some((field) => !outside.has(field));
    if (!kept || !working.has(thing)) {
      continue;
    }
    for (const field of fields) {
      const uses = (outside.get(field) ?? []).filter((usage) => !usage.onlyReadsValue);
      if (uses.length === 0) {
        continue;
      }
      const concerned =
        inScope(model.tree, scope, thing.home) || uses.some((usage) => inScope(model.tree, scope, usage.reference.from));
      if (concerned) {
        diagnostics.push(diagnostic(model, thing, field, uses, others(field, fields, outside)));
      }
    }
  }
  return diagnostics;
}

function worksOnFields(usage: Use): boolean {
  const holder = usage.reference.holder;
  return holder !== undefined && holder.kind === "function" && holder.takesThis;
}

function others(field: Item, fields: readonly Item[], outside: OutsideUses): string[] {
  const known: string[] = [];
  const kept: string[] = [];
  for (const other of fields.filter((other) => other !== field)) {
    const uses = outside.get(other);
    if (uses === undefined) {
      kept.push(bareName(other));
    } else if (uses.some((usage) => !usage.onlyReadsValue)) {
      known.push(bareName(other));
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

function bareName(field: Item): string {
  const name = field.name;
  return name.slice(name.lastIndexOf(".") + 1);
}

interface Site {
  readonly at: Location;
  readonly user: string;
}

function diagnostic(
  model: Model,
  owner: Thing,
  field: Item,
  uses: readonly Use[],
  others: readonly string[],
): Diagnostic {
  const tree = model.tree;
  const sites = new Map<string, Site>();
  const places = new Map<TreeNode, Set<string>>();
  for (const usage of uses) {
    const reference = usage.reference;
    const holder = reference.holder;
    const user =
      holder === undefined ? tree.display(reference.from) : `${tree.display(holder.owner)}:${withoutGenerics(holder.name)}`;
    const through =
      usage.through === undefined ? "" : `, through \`${withoutGenerics(usage.through.name)}\``;
    const at: Location = { file: reference.file.path, line: reference.line };
    const key = clickable(at);
    const inModule = places.get(reference.from) ?? new Set<string>();
    places.set(reference.from, inModule);
    inModule.add(key);
    if (!sites.has(key)) {
      sites.set(key, { at, user: `\`${user}\`${through}` });
    }
  }
  const typeName = withoutGenerics(owner.item.name);
  const fieldName = field.name;
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
    picture: { kind: "spread", owner: `${home}:${typeName}`, field: bareName(field), modules, others },
  };
}
