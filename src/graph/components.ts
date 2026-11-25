const UNSEEN = -1;

export function circles(edges: readonly (readonly number[])[]): number[][] {
  const count = edges.length;
  const index = new Array<number>(count).fill(UNSEEN);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  let next = 0;
  const found: number[][] = [];
  const visit = (node: number): void => {
    index[node] = next;
    low[node] = next;
    next += 1;
    stack.push(node);
    onStack[node] = true;
  };
  for (let start = 0; start < count; start += 1) {
    if (index[start] !== UNSEEN) {
      continue;
    }
    const work: { node: number; edge: number }[] = [{ node: start, edge: 0 }];
    visit(start);
    for (let top = work.at(-1); top !== undefined; top = work.at(-1)) {
      const { node } = top;
      const to = edges[node]?.[top.edge];
      if (to !== undefined) {
        top.edge += 1;
        if (index[to] === UNSEEN) {
          visit(to);
          work.push({ node: to, edge: 0 });
        } else if (onStack[to] === true) {
          low[node] = Math.min(at(low, node), at(index, to));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined) {
        low[parent.node] = Math.min(at(low, parent.node), at(low, node));
      }
      if (at(low, node) === at(index, node)) {
        const component: number[] = [];
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
          onStack[member] = false;
          component.push(member);
          if (member === node) {
            break;
          }
        }
        if (component.length > 1) {
          component.sort((a, b) => a - b);
          found.push(component);
        }
      }
    }
  }
  return found.sort(compareNumberLists);
}

function at(values: readonly number[], position: number): number {
  const value = values[position];
  if (value === undefined) {
    throw new RangeError(`no node ${position}`);
  }
  return value;
}

function compareNumberLists(a: readonly number[], b: readonly number[]): number {
  for (let position = 0; position < Math.min(a.length, b.length); position += 1) {
    const difference = at(a, position) - at(b, position);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}
