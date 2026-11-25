export type NodeKind = "workspace" | "package" | "module";

export class TreeNode {
  readonly name: string;
  readonly kind: NodeKind;
  readonly parent: TreeNode | undefined;
  readonly depth: number;
  #test = false;

  constructor(name: string, kind: NodeKind, parent: TreeNode | undefined) {
    this.name = name;
    this.kind = kind;
    this.parent = parent;
    this.depth = parent === undefined ? 0 : parent.depth + 1;
  }

  get test(): boolean {
    return this.#test;
  }

  markAsTestCode(): void {
    this.#test = true;
  }
}

export class Tree {
  readonly #root = new TreeNode("", "workspace", undefined);
  readonly #nodes: TreeNode[] = [this.#root];
  readonly #positions = new Map<TreeNode, number>([[this.#root, 0]]);
  readonly #children = new Map<TreeNode, Map<string, TreeNode>>();

  package(name: string, within: TreeNode | undefined): TreeNode {
    return this.child(within ?? this.#root, "package", name);
  }

  child(parent: TreeNode, kind: NodeKind, name: string): TreeNode {
    const children = this.#children.get(parent) ?? new Map<string, TreeNode>();
    this.#children.set(parent, children);
    const key = `${kind}\0${name}`;
    const known = children.get(key);
    if (known !== undefined) {
      return known;
    }
    const node = new TreeNode(name, kind, parent);
    this.#positions.set(node, this.#nodes.length);
    this.#nodes.push(node);
    children.set(key, node);
    return node;
  }

  markAsTestCode(node: TreeNode): void {
    node.markAsTestCode();
  }

  eachAfterItsParent(): TreeNode[] {
    return [...this.#nodes];
  }

  compare(a: TreeNode, b: TreeNode): number {
    return this.#position(a) - this.#position(b);
  }

  #position(node: TreeNode): number {
    const position = this.#positions.get(node);
    if (position === undefined) {
      throw new RangeError(`the node ${node.name} is not in this tree`);
    }
    return position;
  }

  parent(node: TreeNode): TreeNode | undefined {
    return node.parent;
  }

  selfThenAncestors(node: TreeNode): TreeNode[] {
    const chain: TreeNode[] = [];
    for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
      chain.push(at);
    }
    return chain;
  }

  commonAncestor(a: TreeNode, b: TreeNode): TreeNode {
    const up = (node: TreeNode): TreeNode => node.parent ?? this.#root;
    while (a.depth > b.depth) {
      a = up(a);
    }
    while (b.depth > a.depth) {
      b = up(b);
    }
    while (a !== b) {
      a = up(a);
      b = up(b);
    }
    return a;
  }

  isWithin(node: TreeNode, ancestor: TreeNode): boolean {
    return this.selfThenAncestors(node).includes(ancestor);
  }

  packageOf(node: TreeNode): TreeNode | undefined {
    return this.selfThenAncestors(node).find((at) => at.kind === "package");
  }

  isTest(node: TreeNode): boolean {
    return this.selfThenAncestors(node).some((at) => at.test);
  }

  display(node: TreeNode): string {
    if (node.kind === "workspace") {
      return ".";
    }
    if (node.kind === "package" || node.parent === undefined) {
      return node.name;
    }
    return `${this.display(node.parent)}/${node.name}`;
  }
}
