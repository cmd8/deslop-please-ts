import { inModelOrder } from "../model/index.ts";

interface Visit {
  readonly index: number;
  low: number;
  onStack: boolean;
}

export function circles<Node>(nodes: readonly Node[], edges: ReadonlyMap<Node, readonly Node[]>): Node[][] {
  const order = inModelOrder(nodes);
  const visits = new Map<Node, Visit>();
  const stack: { readonly node: Node; readonly seen: Visit }[] = [];
  const found: Node[][] = [];
  const visit = (node: Node): Visit => {
    const seen: Visit = { index: visits.size, low: visits.size, onStack: true };
    visits.set(node, seen);
    stack.push({ node, seen });
    return seen;
  };
  for (const start of nodes) {
    if (visits.has(start)) {
      continue;
    }
    const work: { node: Node; seen: Visit; edge: number }[] = [{ node: start, seen: visit(start), edge: 0 }];
    for (let top = work.at(-1); top !== undefined; top = work.at(-1)) {
      const to = edges.get(top.node)?.[top.edge];
      if (to !== undefined) {
        top.edge += 1;
        const known = visits.get(to);
        if (known === undefined) {
          work.push({ node: to, seen: visit(to), edge: 0 });
        } else if (known.onStack) {
          top.seen.low = Math.min(top.seen.low, known.index);
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined) {
        parent.seen.low = Math.min(parent.seen.low, top.seen.low);
      }
      if (top.seen.low === top.seen.index) {
        const component: Node[] = [];
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
          member.seen.onStack = false;
          component.push(member.node);
          if (member.node === top.node) {
            break;
          }
        }
        if (component.length > 1) {
          found.push(component.sort(order));
        }
      }
    }
  }
  return found.sort((a, b) => compareLists(a, b, order));
}

function compareLists<Node>(a: readonly Node[], b: readonly Node[], order: (a: Node, b: Node) => number): number {
  for (const [at, node] of a.entries()) {
    const other = b[at];
    if (other === undefined) {
      return 1;
    }
    const compared = order(node, other);
    if (compared !== 0) {
      return compared;
    }
  }
  return a.length - b.length;
}
