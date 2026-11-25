export function inModelOrder<Element>(all: readonly Element[]): (a: Element, b: Element) => number {
  const positions = new Map(all.map((element, position) => [element, position]));
  const position = (element: Element): number => {
    const found = positions.get(element);
    if (found === undefined) {
      throw new RangeError("an element outside the model has no model order");
    }
    return found;
  };
  return (a, b) => position(a) - position(b);
}
