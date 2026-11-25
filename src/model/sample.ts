import { idFromIndex } from "../id.ts";
import { Tree } from "./tree.ts";
import type { NodeId } from "./tree.ts";
import type { CodeFile, FileId, Item, ItemId, ItemKind, Model, Reference, Wrapper } from "./index.ts";

export const SAMPLE_PACKAGE = "p";

export class Sample {
  readonly tree = new Tree();
  readonly files: CodeFile[] = [];
  readonly items: Item[] = [];
  readonly references: Reference[] = [];
  readonly wrappers = new Map<ItemId, Wrapper>();

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

  package(): NodeId {
    return this.tree.child(this.tree.root, "package", SAMPLE_PACKAGE);
  }

  module(path: string): NodeId {
    let node = this.package();
    for (const name of path.split("/").filter((name) => name !== "")) {
      node = this.tree.child(node, "module", name);
    }
    if (!this.files.some((file) => file.module === node)) {
      this.files.push({ path: `src/${path}.ts`, module: node, test: false, lines: 1 });
    }
    return node;
  }

  file(module: NodeId, path: string, lines: number): void {
    this.files.push({ path, module, test: false, lines });
  }

  item(owner: NodeId, name: string, kind: ItemKind): ItemId {
    this.items.push({
      name,
      owner,
      file: this.firstFileOf(owner),
      kind,
      parent: undefined,
      implementsInheritedMember: false,
      takesThis: false,
    });
    return idFromIndex<ItemId>(this.items.length - 1);
  }

  member(parent: ItemId, owner: NodeId, name: string, kind: ItemKind): ItemId {
    const id = this.item(owner, name, kind);
    this.change(id, { parent });
    return id;
  }

  change(id: ItemId, changes: Partial<Item>): void {
    this.items[id] = { ...this.itemAt(id), ...changes };
  }

  itemAt(id: ItemId): Item {
    const item = this.items[id];
    if (item === undefined) {
      throw new RangeError(`no item ${id} in the sample`);
    }
    return item;
  }

  named(name: string): ItemId {
    const index = this.items.findIndex((item) => item.name === name);
    if (index < 0) {
      throw new RangeError(`no item named ${name} in the sample`);
    }
    return idFromIndex<ItemId>(index);
  }

  refer(holder: ItemId, item: ItemId): void {
    this.reference(holder, item, false);
  }

  read(holder: ItemId, item: ItemId): void {
    this.reference(holder, item, true);
  }

  private reference(holder: ItemId, item: ItemId, onlyReadsValue: boolean): void {
    const from = this.itemAt(holder).owner;
    const file = this.firstFileOf(from);
    if (file === undefined) {
      throw new RangeError(`no file of module ${from} in the sample`);
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

  private firstFileOf(module: NodeId): FileId | undefined {
    const index = this.files.findIndex((file) => file.module === module);
    return index < 0 ? undefined : idFromIndex<FileId>(index);
  }
}
