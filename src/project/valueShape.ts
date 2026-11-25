import { TypeFlags, type Checker, type Type } from "typescript/sync";

export type ValueShape = "primitive" | "plain" | "structured";

const PLAIN_COLLECTIONS = new Set(["Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap"]);
const PLAIN_ALIASES = new Set(["Record"]);
const SHAPE_ORDER: readonly ValueShape[] = ["primitive", "plain", "structured"];

export function widestShape(shapes: Iterable<ValueShape>): ValueShape {
  let widest: ValueShape = "primitive";
  for (const shape of shapes) {
    if (SHAPE_ORDER.indexOf(shape) > SHAPE_ORDER.indexOf(widest)) {
      widest = shape;
    }
  }
  return widest;
}

export class ShapeReader {
  readonly #checker: Checker;
  readonly #known = new Map<number, ValueShape>();

  constructor(checker: Checker) {
    this.#checker = checker;
  }

  shapeOf(type: Type): ValueShape {
    const known = this.#known.get(type.id);
    if (known !== undefined) {
      return known;
    }
    this.#known.set(type.id, "structured");
    const shape = this.#read(type);
    this.#known.set(type.id, shape);
    return shape;
  }

  #read(type: Type): ValueShape {
    if ((type.flags & TypeFlags.Primitive) !== 0) {
      return "primitive";
    }
    if (type.isUnionType()) {
      return widestShape(type.getTypes().map((member) => this.shapeOf(member)));
    }
    const alias = type.getAliasSymbol();
    if (alias !== undefined && PLAIN_ALIASES.has(alias.name)) {
      return this.#plainWhenAllPlain(type.getAliasTypeArguments());
    }
    if (type.isTypeReference() && this.#isPlainCollection(type)) {
      return this.#plainWhenAllPlain(this.#checker.getTypeArguments(type));
    }
    return "structured";
  }

  #isPlainCollection(type: Type): boolean {
    if (type.isTupleType() || this.#checker.isArrayType(type)) {
      return true;
    }
    const symbol = type.getSymbol();
    return symbol !== undefined && PLAIN_COLLECTIONS.has(symbol.name);
  }

  #plainWhenAllPlain(elements: readonly Type[]): ValueShape {
    return widestShape(elements.map((element) => this.shapeOf(element))) === "structured" ? "structured" : "plain";
  }
}
