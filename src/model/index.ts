import type { Tree, TreeNode } from "./tree.ts";

export { Tree, TreeNode } from "./tree.ts";
export type { NodeKind } from "./tree.ts";
export { inModelOrder } from "./order.ts";

export interface CodeFile {
  readonly path: string;
  readonly module: TreeNode;
  readonly test: boolean;
  readonly lines: number;
}

export type ItemKind = "type" | "function" | "field" | "variant" | "constant";

export interface Item {
  readonly name: string;
  readonly owner: TreeNode;
  readonly file: CodeFile | undefined;
  readonly kind: ItemKind;
  readonly parent: Item | undefined;
  readonly implementsInheritedMember: boolean;
  readonly takesThis: boolean;
}

export interface Reference {
  readonly file: CodeFile;
  readonly line: number;
  readonly from: TreeNode;
  readonly holder: Item | undefined;
  readonly item: Item;
  readonly onlyReadsValue: boolean;
  readonly test: boolean;
}

export type Wrapper =
  | { readonly kind: "forwarder"; readonly target: Item; readonly fieldsCalledOn: readonly Item[] }
  | {
      readonly kind: "accessor";
      readonly lent: readonly Item[];
      readonly copied: readonly Item[];
      readonly lendsOnlyToRead: boolean;
    };

export interface Model {
  readonly tree: Tree;
  readonly files: readonly CodeFile[];
  readonly items: readonly Item[];
  readonly references: readonly Reference[];
  readonly wrappers: ReadonlyMap<Item, Wrapper>;
}
