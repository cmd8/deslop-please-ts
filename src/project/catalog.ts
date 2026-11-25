import {
  isGetAccessorDeclaration,
  isMethodDeclaration,
  isSetAccessorDeclaration,
  type ClassDeclaration,
  type Node,
  type SourceFile,
} from "typescript/ast";
import type { API, Checker, Symbol as CompilerSymbol } from "typescript/sync";
import type { CodeFile, Item, ItemKind } from "../model/index.ts";
import { declarationsOf, type Declaration } from "./declarations.ts";
import { inheritedMemberNames } from "./inheritance.ts";
import { functionPartsOf, nodeKey } from "./syntax.ts";
import type { ShapeReader, ValueShape } from "./valueShape.ts";

export type DeclarationForm = "method" | "accessor" | "other";

export interface HandleAt {
  readonly path: string;
  readonly index: number;
}

export interface DeclarationRecord {
  readonly key: string;
  readonly handleIndex: number | undefined;
  readonly name: string;
  readonly memberName: string;
  readonly kind: ItemKind;
  readonly parent: DeclarationRecord | undefined;
  readonly takesThis: boolean;
  readonly firstElsewhere: HandleAt | undefined;
  readonly implementsInheritedMember: boolean;
  readonly shape: ValueShape | undefined;
  readonly form: DeclarationForm;
  readonly parameterCount: number | undefined;
  readonly hasBody: boolean;
}

export interface SourceRecord {
  readonly path: string;
  readonly declarations: readonly DeclarationRecord[];
}

interface Placed {
  readonly declaration: DeclarationRecord;
  readonly item: Item;
}

export class Catalog {
  readonly items: readonly Item[];
  readonly declarationsOf: ReadonlyMap<Item, readonly DeclarationRecord[]>;
  readonly memberNames: ReadonlySet<string>;
  readonly fieldShapes: ReadonlyMap<Item, ValueShape>;
  readonly constructorOf: ReadonlyMap<Item, Item>;
  readonly #placed: ReadonlyMap<string, ReadonlyMap<string, Placed>>;
  readonly #declaredBy: ReadonlyMap<string, ReadonlyMap<number, Item>>;

  constructor(parts: CatalogParts, placed: ReadonlyMap<string, ReadonlyMap<string, Placed>>) {
    this.items = parts.items;
    this.declarationsOf = parts.declarationsOf;
    this.memberNames = parts.memberNames;
    this.fieldShapes = parts.fieldShapes;
    this.constructorOf = parts.constructorOf;
    this.#placed = placed;
    this.#declaredBy = new Map(
      [...placed].map(([path, inFile]) => [
        path,
        new Map(
          [...inFile.values()].flatMap(({ declaration, item }): [number, Item][] =>
            declaration.handleIndex === undefined ? [] : [[declaration.handleIndex, item]],
          ),
        ),
      ]),
    );
  }

  itemAt(path: string, node: Node): Item | undefined {
    return this.#placed.get(path)?.get(nodeKey(node))?.item;
  }

  declarationAt(path: string, node: Node): DeclarationRecord | undefined {
    return this.#placed.get(path)?.get(nodeKey(node))?.declaration;
  }

  itemDeclaredBy(handle: HandleAt): Item | undefined {
    return this.#declaredBy.get(handle.path)?.get(handle.index);
  }
}

interface CatalogParts {
  readonly items: readonly Item[];
  readonly declarationsOf: ReadonlyMap<Item, readonly DeclarationRecord[]>;
  readonly memberNames: ReadonlySet<string>;
  readonly fieldShapes: ReadonlyMap<Item, ValueShape>;
  readonly constructorOf: ReadonlyMap<Item, Item>;
}

const CONSTRUCTOR = "constructor";

export function recordSource(api: API, checker: Checker, shapes: ShapeReader, tree: SourceFile): SourceRecord {
  const declarations = declarationsOf(tree);
  const symbols = symbolsOfNames(checker, declarations);
  const inherited = inheritedMemberNames(api, checker, classesOf(declarations));
  const fields = declarations.flatMap((declaration) => {
    const symbol = symbols.get(declaration);
    return declaration.kind === "field" && symbol !== undefined ? [{ declaration, symbol }] : [];
  });
  const fieldTypes = fields.length === 0 ? [] : checker.getTypeOfSymbol(fields.map((field) => field.symbol));
  const fieldShapes = new Map<Declaration, ValueShape>();
  fields.forEach((field, index) => {
    const type = fieldTypes[index];
    fieldShapes.set(field.declaration, type === undefined ? "structured" : shapes.shapeOf(type));
  });
  const records = new Map<Declaration, DeclarationRecord>();
  for (const declaration of declarations) {
    const handles = symbols.get(declaration)?.declarations ?? [];
    const key = nodeKey(declaration.node);
    const own = handles.find(
      (handle) => handle.path === tree.path && handle.kind === declaration.node.kind && sameKey(handle.resolve(), key),
    );
    const first = handles[0];
    const parts = functionPartsOf(declaration.node);
    const elsewhere = first !== undefined && first !== own;
    records.set(declaration, {
      key,
      handleIndex: own?.index,
      name: declaration.name,
      memberName: declaration.memberName,
      kind: declaration.kind,
      parent: declaration.parent === undefined ? undefined : records.get(declaration.parent),
      takesThis: declaration.takesThis,
      firstElsewhere: elsewhere ? { path: first.path, index: first.index } : undefined,
      implementsInheritedMember:
        declaration.memberOf !== undefined &&
        declaration.memberName !== CONSTRUCTOR &&
        (inherited.get(declaration.memberOf)?.has(declaration.memberName) ?? false),
      shape: fieldShapes.get(declaration),
      form: formOf(declaration.node),
      parameterCount: parts?.parameters.length,
      hasBody: parts?.body !== undefined,
    });
  }
  return { path: tree.path, declarations: [...records.values()] };
}

export interface FiledRecord {
  readonly record: SourceRecord;
  readonly file: CodeFile;
}

interface FiledDeclaration {
  readonly declaration: DeclarationRecord;
  readonly file: CodeFile;
}

export function catalogItems(sources: readonly FiledRecord[]): Catalog {
  const byPath = new Map(
    sources.map(({ record, file }) => [
      record.path,
      new Map(
        record.declarations.flatMap((declaration): [number, FiledDeclaration][] =>
          declaration.handleIndex === undefined ? [] : [[declaration.handleIndex, { declaration, file }]],
        ),
      ),
    ]),
  );
  const canonicalOf = (filed: FiledDeclaration): FiledDeclaration => {
    const first = filed.declaration.firstElsewhere;
    return (first === undefined ? undefined : byPath.get(first.path)?.get(first.index)) ?? filed;
  };
  const itemOfCanonical = new Map<DeclarationRecord, Item>();
  const itemFor = ({ declaration, file }: FiledDeclaration): Item => {
    const known = itemOfCanonical.get(declaration);
    if (known !== undefined) {
      return known;
    }
    const parent = declaration.parent === undefined ? undefined : canonicalOf({ declaration: declaration.parent, file });
    const item: Item = {
      name: declaration.name,
      owner: file.module,
      file,
      kind: declaration.kind,
      parent: parent === undefined ? undefined : itemFor(parent),
      implementsInheritedMember: declaration.implementsInheritedMember,
      takesThis: declaration.takesThis,
    };
    itemOfCanonical.set(declaration, item);
    return item;
  };
  const canonical = sources.flatMap(({ record, file }) =>
    record.declarations.flatMap((declaration) => {
      const filed = { declaration, file };
      return canonicalOf(filed).declaration === declaration ? [filed] : [];
    }),
  );
  const items = canonical.map(itemFor);

  const placed = new Map<string, Map<string, Placed>>();
  const declarationsOf = new Map<Item, DeclarationRecord[]>();
  for (const { record, file } of sources) {
    const inFile = new Map<string, Placed>();
    placed.set(record.path, inFile);
    for (const declaration of record.declarations) {
      const item = itemOfCanonical.get(canonicalOf({ declaration, file }).declaration);
      if (item !== undefined) {
        inFile.set(declaration.key, { declaration, item });
        const declarations = declarationsOf.get(item) ?? [];
        declarationsOf.set(item, declarations);
        declarations.push(declaration);
      }
    }
  }
  const fieldShapes = new Map<Item, ValueShape>();
  const constructorOf = new Map<Item, Item>();
  for (const [item, declarations] of declarationsOf) {
    const shape = declarations.find((declaration) => declaration.shape !== undefined)?.shape;
    if (shape !== undefined) {
      fieldShapes.set(item, shape);
    }
    if (item.kind === "function" && item.parent !== undefined && declarations[0]?.memberName === CONSTRUCTOR) {
      constructorOf.set(item.parent, item);
    }
  }
  return new Catalog(
    {
      items,
      declarationsOf,
      memberNames: new Set(canonical.map(({ declaration }) => declaration.memberName)),
      fieldShapes,
      constructorOf,
    },
    placed,
  );
}

function sameKey(node: Node | undefined, key: string): boolean {
  return node !== undefined && nodeKey(node) === key;
}

function formOf(node: Node): DeclarationForm {
  if (isGetAccessorDeclaration(node) || isSetAccessorDeclaration(node)) {
    return "accessor";
  }
  return isMethodDeclaration(node) ? "method" : "other";
}

function classesOf(declarations: readonly Declaration[]): ClassDeclaration[] {
  return [
    ...new Set(declarations.flatMap((declaration) => (declaration.memberOf === undefined ? [] : [declaration.memberOf]))),
  ];
}

function symbolsOfNames(checker: Checker, declarations: readonly Declaration[]): Map<Declaration, CompilerSymbol> {
  const named = declarations.flatMap((declaration) =>
    declaration.symbolName === undefined ? [] : [{ declaration, name: declaration.symbolName }],
  );
  const symbols = new Map<Declaration, CompilerSymbol>();
  if (named.length === 0) {
    return symbols;
  }
  const found = checker.getSymbolAtLocation(named.map((each) => each.name));
  named.forEach((each, index) => {
    const symbol = found[index];
    if (symbol !== undefined) {
      symbols.set(each.declaration, symbol);
    }
  });
  return symbols;
}
