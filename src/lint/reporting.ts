import type { Thing } from "../graph/index.ts";
import type { Item, Model, Reference, Tree, TreeNode } from "../model/index.ts";
import { HELD_IN_MIND, compareLocations, compareText } from "./diagnostic.ts";
import type { Location, Picture, Step } from "./diagnostic.ts";

export type ItemOrder = (a: Item, b: Item) => number;

export const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

export const INDEX_FILE_NAMES = TYPESCRIPT_EXTENSIONS.map((extension) => `index${extension}`);

export class Tie {
  readonly #items = new Set<Item>();
  readonly #holders = new Set<Item>();
  #firstSite: Location | undefined;
  readonly #firstSiteInModule = new Map<TreeNode, Location>();

  add(item: Item, reference: Reference, module: TreeNode): void {
    this.#items.add(item);
    if (reference.holder !== undefined) {
      this.#holders.add(reference.holder);
    }
    const site: Location = { file: reference.file.path, line: reference.line };
    const first = this.#firstSiteInModule.get(module);
    if (first === undefined || compareLocations(site, first) < 0) {
      this.#firstSiteInModule.set(module, site);
    }
    if (this.#firstSite === undefined || compareLocations(site, this.#firstSite) < 0) {
      this.#firstSite = site;
    }
  }

  get cost(): number {
    return this.#items.size;
  }

  get site(): Location {
    if (this.#firstSite === undefined) {
      throw new RangeError("a tie has a site once a reference is added");
    }
    return this.#firstSite;
  }

  note(order: ItemOrder, verb: string, user: string, used: string): string {
    const site = this.site;
    const elsewhere = uniqueLocations([...this.#firstSiteInModule.values()])
      .filter((first) => compareLocations(first, site) !== 0)
      .map(clickable);
    const also = elsewhere.length === 0 ? "" : `; also at ${listed(elsewhere)}`;
    const items = counted(this.#items.size, "item");
    return `${clickable(site)}: \`${user}\` ${verb} \`${used}\` by ${items}: ${listed(names(order, this.#items))}${also}`;
  }

  step(order: ItemOrder, member: string): Step {
    const items = grouped(names(order, this.#items));
    const holders = names(order, this.#holders);
    const uses = holders.length === 1 ? `${holders[0]} uses ${items}` : `uses ${items}`;
    return { member, site: this.site, uses };
  }
}

export interface NamedTie {
  readonly user: string;
  readonly used: string;
  readonly tie: Tie;
}

export interface CircleReport {
  readonly location: Location | undefined;
  readonly notes: readonly string[];
  readonly picture: Picture;
}

export function circleReport(
  order: ItemOrder,
  verb: string,
  noun: string,
  members: number,
  unsorted: readonly NamedTie[],
): CircleReport {
  const ties = [...unsorted].sort(
    (a, b) => a.tie.cost - b.tie.cost || compareText(a.user, b.user) || compareText(a.used, b.used),
  );
  const notes = ties.slice(0, HELD_IN_MIND).map(({ user, used, tie }) => tie.note(order, verb, user, used));
  if (ties.length > HELD_IN_MIND) {
    notes.push(`and ${counted(ties.length - HELD_IN_MIND, "more tie")}`);
  }
  const circle = shortestCircle(ties).map((at) => tiedAt(ties, at));
  const steps = circle.map(({ user, tie }) => tie.step(order, user));
  const leftOut = [
    { count: members - circle.length, noun: `more ${noun}` },
    { count: ties.length - circle.length, noun: "more tie" },
  ]
    .filter(({ count }) => count > 0)
    .map(({ count, noun }) => counted(count, noun));
  const rest = leftOut.length === 0 ? undefined : `not drawn: ${leftOut.join(", ")}`;
  return { location: ties[0]?.tie.site, notes, picture: { kind: "circle", steps, rest } };
}

export interface TiedPair {
  readonly user: string;
  readonly used: string;
}

export function shortestCircle(ties: readonly TiedPair[]): number[] {
  const { user: start, used: end } = tiedAt(ties, 0);
  const reachedBy = new Map<string, number | undefined>([[end, undefined]]);
  const queue = [end];
  for (let at = queue.shift(); at !== undefined && at !== start; at = queue.shift()) {
    ties.forEach(({ user, used }, index) => {
      if (user === at && !reachedBy.has(used)) {
        reachedBy.set(used, index);
        queue.push(used);
      }
    });
  }
  const circle: number[] = [];
  for (let index = reachedBy.get(start); index !== undefined; index = reachedBy.get(tiedAt(ties, index).user)) {
    circle.push(index);
  }
  circle.push(0);
  return circle.reverse();
}

function tiedAt<Pair extends TiedPair>(ties: readonly Pair[], index: number): Pair {
  const tie = ties[index];
  if (tie === undefined) {
    throw new RangeError(`no tie ${index}`);
  }
  return tie;
}

export function grouped(names: readonly string[]): string {
  const groups = new Map<string, { named: boolean; members: string[] }>();
  for (const name of names) {
    const dot = name.indexOf(".");
    const head = dot < 0 ? name : name.slice(0, dot);
    const group = groups.get(head) ?? { named: false, members: [] };
    groups.set(head, group);
    if (dot < 0) {
      group.named = true;
    } else {
      group.members.push(name.slice(dot + 1));
    }
  }
  const written = [...groups].map(([head, { named, members }]) => {
    const membersWritten = writtenMembers(head, members);
    if (membersWritten === undefined) {
      return head;
    }
    return named ? `${head}, ${membersWritten}` : membersWritten;
  });
  return listed(written);
}

function writtenMembers(head: string, members: readonly string[]): string | undefined {
  const [only] = members;
  if (only === undefined) {
    return undefined;
  }
  return members.length === 1 ? `${head}.${only}` : `${head}.{${listed(members)}}`;
}

function names(order: ItemOrder, items: ReadonlySet<Item>): string[] {
  return [...items].sort(order).map((item) => withoutGenerics(item.name));
}

function uniqueLocations(locations: readonly Location[]): Location[] {
  return [...new Map(locations.map((location) => [clickable(location), location])).values()].sort(compareLocations);
}

export function clickable(location: Location): string {
  return `${location.file}:${location.line}:1`;
}

export function inScope(tree: Tree, scope: TreeNode | undefined, node: TreeNode): boolean {
  return scope === undefined || tree.isWithin(node, scope);
}

export function fullName(tree: Tree, thing: Thing): string {
  return `${tree.display(thing.home)}:${withoutGenerics(thing.item.name)}`;
}

export function listed(names: readonly string[]): string {
  const shown = names.slice(0, HELD_IN_MIND).join(", ");
  const more = names.length - HELD_IN_MIND;
  return more > 0 ? `${shown}, +${more} more` : shown;
}

export function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

const ENDS_IN_NAME_CHARACTER = /[\p{L}\p{N}_$]$/u;

export function withoutGenerics(name: string): string {
  let out = "";
  let depth = 0;
  for (const character of name) {
    if (character === "<" && (depth > 0 || ENDS_IN_NAME_CHARACTER.test(out))) {
      depth += 1;
    } else if (character === ">" && depth > 0) {
      depth -= 1;
    } else if (depth === 0) {
      out += character;
    }
  }
  return out;
}

export function moduleLocation(model: Model, module: TreeNode): Location | undefined {
  const rank = (path: string): number => (INDEX_FILE_NAMES.some((name) => path === name || path.endsWith(`/${name}`)) ? 0 : 1);
  const [primary] = model.files
    .filter((file) => !file.test && file.module === module)
    .map((file) => file.path)
    .sort((a, b) => rank(a) - rank(b) || compareText(a, b));
  return primary === undefined ? undefined : { file: primary, line: 1 };
}
