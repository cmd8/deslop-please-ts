declare const nodeIdBrand: unique symbol;
export type NodeId = number & { readonly [nodeIdBrand]: true };

export type NodeKind = "workspace" | "package" | "module";

export interface TreeNode {
  readonly name: string;
  readonly kind: NodeKind;
  readonly parent: NodeId | undefined;
  readonly depth: number;
  readonly test: boolean;
}

const ROOT = 0 as NodeId;

export class Tree {
  readonly #nodes: TreeNode[] = [
    { name: "", kind: "workspace", parent: undefined, depth: 0, test: false },
  ];
  readonly #children = new Map<string, NodeId>();

  get root(): NodeId {
    return ROOT;
  }

  child(parent: NodeId, kind: NodeKind, name: string): NodeId {
    const key = `${parent}\0${kind}\0${name}`;
    const known = this.#children.get(key);
    if (known !== undefined) {
      return known;
    }
    const id = this.#nodes.length as NodeId;
    this.#nodes.push({
      name,
      kind,
      parent,
      depth: this.node(parent).depth + 1,
      test: false,
    });
    this.#children.set(key, id);
    return id;
  }

  node(id: NodeId): TreeNode {
    const node = this.#nodes[id];
    if (node === undefined) {
      throw new RangeError(`no node ${id} in the tree`);
    }
    return node;
  }

  markAsTestCode(id: NodeId): void {
    this.#nodes[id] = { ...this.node(id), test: true };
  }

  eachAfterItsParent(): NodeId[] {
    return this.#nodes.map((_, index) => index as NodeId);
  }

  parent(id: NodeId): NodeId | undefined {
    return this.node(id).parent;
  }

  selfThenAncestors(id: NodeId): NodeId[] {
    const chain: NodeId[] = [];
    for (let at: NodeId | undefined = id; at !== undefined; at = this.parent(at)) {
      chain.push(at);
    }
    return chain;
  }

  commonAncestor(a: NodeId, b: NodeId): NodeId {
    const up = (id: NodeId): NodeId => this.parent(id) ?? ROOT;
    while (this.node(a).depth > this.node(b).depth) {
      a = up(a);
    }
    while (this.node(b).depth > this.node(a).depth) {
      b = up(b);
    }
    while (a !== b) {
      a = up(a);
      b = up(b);
    }
    return a;
  }

  isWithin(id: NodeId, ancestor: NodeId): boolean {
    return this.selfThenAncestors(id).includes(ancestor);
  }

  packageOf(id: NodeId): NodeId | undefined {
    return this.selfThenAncestors(id).find((at) => this.node(at).kind === "package");
  }

  isTest(id: NodeId): boolean {
    return this.selfThenAncestors(id).some((at) => this.node(at).test);
  }

  display(id: NodeId): string {
    const node = this.node(id);
    if (node.kind === "workspace") {
      return ".";
    }
    if (node.kind === "package" || node.parent === undefined) {
      return node.name;
    }
    return `${this.display(node.parent)}/${node.name}`;
  }
}
