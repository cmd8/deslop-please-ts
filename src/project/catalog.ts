import {
  isGetAccessorDeclaration,
  isMethodDeclaration,
  isSetAccessorDeclaration,
  type ClassDeclaration,
  type Node,
  type SourceFile,
} from "typescript/ast";
import type { API, Checker, Symbol as CompilerSymbol } from "typescript/sync";
import { idFromIndex } from "../id.ts";
import type { CodeFile, FileId, Item, ItemId, ItemKind } from "../model/index.ts";
import { declarationsOf, type Declaration } from "./declarations.ts";
import { inheritedMemberNames } from "./inheritance.ts";
import { functionPartsOf, nodeIndex } from "./syntax.ts";
import type { ShapeReader, ValueShape } from "./valueShape.ts";

export type DeclarationForm = "method" | "accessor" | "other";

export interface NodeAt {
  readonly path: string;
  readonly index: number;
}

export interface DeclarationRecord {
  readonly index: number;
  readonly name: string;
  readonly memberName: string;
  readonly kind: ItemKind;
  readonly parent: DeclarationRecord | undefined;
  readonly takesThis: boolean;
  readonly firstElsewhere: NodeAt | undefined;
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
  readonly item: ItemId;
}

export class Catalog {
  readonly items: readonly Item[];
  readonly declarationsOf: readonly (readonly DeclarationRecord[])[];
  readonly memberNames: ReadonlySet<string>;
  readonly fieldShapes: ReadonlyMap<ItemId, ValueShape>;
  readonly constructorOf: ReadonlyMap<ItemId, ItemId>;
  readonly #placed: ReadonlyMap<string, ReadonlyMap<number, Placed>>;

  constructor(
    parts: CatalogParts,
    placed: ReadonlyMap<string, ReadonlyMap<number, Placed>>,
  ) {
    this.items = parts.items;
    this.declarationsOf = parts.declarationsOf;
    this.memberNames = parts.memberNames;
    this.fieldShapes = parts.fieldShapes;
    this.constructorOf = parts.constructorOf;
    this.#placed = placed;
  }

  itemAt(path: string, index: number): ItemId | undefined {
    return this.#placed.get(path)?.get(index)?.item;
  }

  declarationAt(path: string, index: number): DeclarationRecord | undefined {
    return this.#placed.get(path)?.get(index)?.declaration;
  }
}

interface CatalogParts {
  readonly items: readonly Item[];
  readonly declarationsOf: readonly (readonly DeclarationRecord[])[];
  readonly memberNames: ReadonlySet<string>;
  readonly fieldShapes: ReadonlyMap<ItemId, ValueShape>;
  readonly constructorOf: ReadonlyMap<ItemId, ItemId>;
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
    const first = symbols.get(declaration)?.declarations[0];
    const parts = functionPartsOf(declaration.node);
    const index = nodeIndex(declaration.node);
    const elsewhere = first !== undefined && (first.path !== tree.path || first.index !== index);
    records.set(declaration, {
      index,
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

export function catalogItems(sources: readonly SourceRecord[], files: readonly CodeFile[]): Catalog {
  const placed = new Map<string, Map<number, Placed>>();
  const declarationsOfItem: DeclarationRecord[][] = [];
  const canonical: { readonly declaration: DeclarationRecord; readonly file: FileId }[] = [];
  const declaredAt = new Map(sources.map((source) => [source.path, new Set(source.declarations.map((each) => each.index))]));
  const isKnown = (at: NodeAt) => declaredAt.get(at.path)?.has(at.index) ?? false;
  sources.forEach((source, index) => {
    const inFile = new Map<number, Placed>();
    placed.set(source.path, inFile);
    for (const declaration of source.declarations) {
      const first = declaration.firstElsewhere;
      if (first === undefined || !isKnown(first)) {
        const item = idFromIndex<ItemId>(declarationsOfItem.length);
        inFile.set(declaration.index, { declaration, item });
        declarationsOfItem.push([]);
        canonical.push({ declaration, file: idFromIndex(index) });
      }
    }
  });
  for (const source of sources) {
    const inFile = placed.get(source.path);
    for (const declaration of source.declarations) {
      const first = declaration.firstElsewhere;
      const item =
        first === undefined || !isKnown(first)
          ? inFile?.get(declaration.index)?.item
          : placed.get(first.path)?.get(first.index)?.item;
      if (item !== undefined) {
        inFile?.set(declaration.index, { declaration, item });
        declarationsOfItem[item]?.push(declaration);
      }
    }
  }
  const itemOfRecord = new Map<DeclarationRecord, ItemId>();
  for (const inFile of placed.values()) {
    for (const each of inFile.values()) {
      itemOfRecord.set(each.declaration, each.item);
    }
  }

  const items = canonical.map(({ declaration, file }): Item => {
    const codeFile = files[file];
    if (codeFile === undefined) {
      throw new RangeError(`no file ${file} in the layout`);
    }
    return {
      name: declaration.name,
      owner: codeFile.module,
      file,
      kind: declaration.kind,
      parent: declaration.parent === undefined ? undefined : itemOfRecord.get(declaration.parent),
      implementsInheritedMember: declaration.implementsInheritedMember,
      takesThis: declaration.takesThis,
    };
  });
  const fieldShapes = new Map<ItemId, ValueShape>();
  const constructorOf = new Map<ItemId, ItemId>();
  declarationsOfItem.forEach((declarations, index) => {
    const id = idFromIndex<ItemId>(index);
    const shape = declarations.find((declaration) => declaration.shape !== undefined)?.shape;
    if (shape !== undefined) {
      fieldShapes.set(id, shape);
    }
    const item = items[id];
    if (item?.kind === "function" && item.parent !== undefined && declarations[0]?.memberName === CONSTRUCTOR) {
      constructorOf.set(item.parent, id);
    }
  });
  return new Catalog(
    {
      items,
      declarationsOf: declarationsOfItem,
      memberNames: new Set(canonical.map(({ declaration }) => declaration.memberName)),
      fieldShapes,
      constructorOf,
    },
    placed,
  );
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
