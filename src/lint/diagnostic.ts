export const LINTS = [
  "module-cycle",
  "tangle",
  "field-leak",
  "shallow-module",
  "wide-directory",
  "long-file",
] as const;

export type Lint = (typeof LINTS)[number];

export function parseLint(name: string): Lint | undefined {
  return LINTS.find((lint) => lint === name);
}

export function compareLints(a: Lint, b: Lint): number {
  return LINTS.indexOf(a) - LINTS.indexOf(b);
}

export const HELD_IN_MIND = 7;

export interface Location {
  readonly file: string;
  readonly line: number;
}

export interface Step {
  readonly member: string;
  readonly site: Location;
  readonly uses: string;
}

export interface PlacesInModule {
  readonly places: number;
  readonly module: string;
}

export interface LongList {
  readonly name: string;
  readonly length: number;
}

export type Picture =
  | { readonly kind: "circle"; readonly steps: readonly Step[]; readonly rest: string | undefined }
  | {
      readonly kind: "spread";
      readonly owner: string;
      readonly field: string;
      readonly modules: readonly PlacesInModule[];
      readonly others: readonly string[];
    }
  | { readonly kind: "lists"; readonly shown: number; readonly hidden: number; readonly lists: readonly LongList[] }
  | { readonly kind: "bar"; readonly label: string; readonly length: number; readonly most: number };

export interface Diagnostic {
  readonly lint: Lint;
  readonly key: string;
  readonly message: string;
  readonly location: Location | undefined;
  readonly notes: readonly string[];
  readonly picture: Picture;
}

export function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

export function compareLocations(a: Location, b: Location): number {
  return compareText(a.file, b.file) || a.line - b.line;
}

export function compareTextLists(a: readonly string[], b: readonly string[]): number {
  for (const [position, text] of a.entries()) {
    const other = b[position];
    if (other === undefined) {
      return 1;
    }
    const order = compareText(text, other);
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
}
