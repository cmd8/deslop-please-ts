import { Tree } from "./tree.ts";
import type { TreeNode } from "./tree.ts";
import type { CodeFile, Item, ItemKind, Model, Reference, Wrapper } from "./index.ts";

export const SAMPLE_PACKAGE = "p";

type SampleItem = { -readonly [Key in keyof Item]: Item[Key] };

export class Sample {
  readonly tree = new Tree();
  readonly files: CodeFile[] = [];
  readonly items: SampleItem[] = [];
  readonly references: Reference[] = [];
  readonly wrappers = new Map<Item, Wrapper>();

  constructor() {
    this.package();
  }

  get model(): Model {
    return {
      tree: this.tree,
      files: this.files,
      items: this.items,
      references: this.references,
      wrappers: this.wrappers,
    };
  }

  package(): TreeNode {
    return this.tree.package(SAMPLE_PACKAGE, undefined);
  }

  module(path: string): TreeNode {
    let node = this.package();
    for (const name of path.split("/").filter((name) => name !== "")) {
      node = this.tree.child(node, "module", name);
    }
    if (!this.files.some((file) => file.module === node)) {
      this.files.push({ path: `src/${path}.ts`, module: node, test: false, lines: 1 });
    }
    return node;
  }

  file(module: TreeNode, path: string, lines: number): CodeFile {
    const file = { path, module, test: false, lines };
    this.files.push(file);
    return file;
  }

  item(owner: TreeNode, name: string, kind: ItemKind): SampleItem {
    const item: SampleItem = {
      name,
      owner,
      file: this.firstFileOf(owner),
      kind,
      parent: undefined,
      implementsInheritedMember: false,
      takesThis: false,
    };
    this.items.push(item);
    return item;
  }

  member(parent: Item, owner: TreeNode, name: string, kind: ItemKind): SampleItem {
    const item = this.item(owner, name, kind);
    item.parent = parent;
    return item;
  }

  named(name: string): SampleItem {
    const item = this.items.find((each) => each.name === name);
    if (item === undefined) {
      throw new RangeError(`no item named ${name} in the sample`);
    }
    return item;
  }

  refer(holder: Item, item: Item): void {
    this.reference(holder, item, false);
  }

  read(holder: Item, item: Item): void {
    this.reference(holder, item, true);
  }

  private reference(holder: Item, item: Item, onlyReadsValue: boolean): void {
    const from = holder.owner;
    const file = this.firstFileOf(from);
    if (file === undefined) {
      throw new RangeError(`no file of module ${from.name} in the sample`);
    }
    this.references.push({
      file,
      line: this.references.length + 1,
      from,
      holder,
      item,
      onlyReadsValue,
      test: false,
    });
  }

  private firstFileOf(module: TreeNode): CodeFile | undefined {
    return this.files.find((file) => file.module === module);
  }
}
