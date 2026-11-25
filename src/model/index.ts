import type { NodeId, Tree } from "./tree.ts";

export { Tree } from "./tree.ts";
export type { NodeId, NodeKind, TreeNode } from "./tree.ts";

declare const fileIdBrand: unique symbol;
export type FileId = number & { readonly [fileIdBrand]: true };

declare const itemIdBrand: unique symbol;
export type ItemId = number & { readonly [itemIdBrand]: true };

export interface CodeFile {
  readonly path: string;
  readonly module: NodeId;
  readonly test: boolean;
  readonly lines: number;
}

export type ItemKind = "type" | "function" | "field" | "variant" | "constant";

export interface Item {
  readonly name: string;
  readonly owner: NodeId;
  readonly file: FileId | undefined;
  readonly kind: ItemKind;
  readonly parent: ItemId | undefined;
  readonly implementsInheritedMember: boolean;
  readonly takesThis: boolean;
}

export interface Reference {
  readonly file: FileId;
  readonly line: number;
  readonly from: NodeId;
  readonly holder: ItemId | undefined;
  readonly item: ItemId;
  readonly onlyReadsValue: boolean;
  readonly test: boolean;
}

export type Wrapper =
  | { readonly kind: "forwarder"; readonly target: ItemId; readonly fieldsCalledOn: readonly ItemId[] }
  | {
      readonly kind: "accessor";
      readonly lent: readonly ItemId[];
      readonly copied: readonly ItemId[];
      readonly lendsOnlyToRead: boolean;
    };

export interface Model {
  readonly tree: Tree;
  readonly files: readonly CodeFile[];
  readonly items: readonly Item[];
  readonly references: readonly Reference[];
  readonly wrappers: ReadonlyMap<ItemId, Wrapper>;
}

export function fileOf(model: Model, id: FileId): CodeFile {
  const file = model.files[id];
  if (file === undefined) {
    throw new RangeError(`no file ${id} in the model`);
  }
  return file;
}

export function itemOf(model: Model, id: ItemId): Item {
  const item = model.items[id];
  if (item === undefined) {
    throw new RangeError(`no item ${id} in the model`);
  }
  return item;
}
