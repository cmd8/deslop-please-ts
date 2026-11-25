import type { ClassDeclaration } from "typescript/ast";
import type { API, Symbol as CompilerSymbol } from "typescript/sync";
import type { CodeFile, FileId, Item, ItemId } from "../model/index.ts";
import { declarationsOf, type Declaration } from "./declarations.ts";
import { inheritedMemberNames } from "./inheritance.ts";
import type { AnalyzedSource } from "./programs.ts";
import { declarationKey, keyOfNode, type DeclarationKey } from "./syntax.ts";
import { ShapeReader, type ValueShape } from "./valueShape.ts";

export interface PlacedDeclaration {
  readonly declaration: Declaration;
  readonly source: AnalyzedSource;
  readonly key: DeclarationKey;
}

export interface Catalog {
  readonly items: readonly Item[];
  readonly itemAt: ReadonlyMap<DeclarationKey, ItemId>;
  readonly declarationsOf: readonly (readonly PlacedDeclaration[])[];
  readonly memberNames: ReadonlySet<string>;
  readonly fieldShapes: ReadonlyMap<ItemId, ValueShape>;
  readonly shapeReaders: ReadonlyMap<AnalyzedSource, ShapeReader>;
}

interface SourceDeclarations {
  readonly source: AnalyzedSource;
  readonly file: FileId;
  readonly placed: readonly PlacedDeclaration[];
  readonly symbols: ReadonlyMap<PlacedDeclaration, CompilerSymbol>;
}

export function catalogItems(api: API, sources: readonly AnalyzedSource[], files: readonly CodeFile[]): Catalog {
  const perSource = sources.map((source, index) => placeDeclarations(source, index as FileId));
  const knownKeys = new Set(perSource.flatMap((entry) => entry.placed.map((placed) => placed.key)));
  const withSymbols = perSource.map((entry) => ({ ...entry, symbols: symbolsOfNames(entry) }));
  const canonicalKey = new Map<DeclarationKey, DeclarationKey>();
  for (const entry of withSymbols) {
    for (const placed of entry.placed) {
      const first = entry.symbols.get(placed)?.declarations[0];
      const firstKey = first === undefined ? undefined : declarationKey(first.path, first.index);
      canonicalKey.set(placed.key, firstKey !== undefined && knownKeys.has(firstKey) ? firstKey : placed.key);
    }
  }

  const itemAt = new Map<DeclarationKey, ItemId>();
  const declarationsOfItem: PlacedDeclaration[][] = [];
  const canonical: { readonly placed: PlacedDeclaration; readonly entry: SourceDeclarations }[] = [];
  for (const entry of withSymbols) {
    for (const placed of entry.placed) {
      if (canonicalKey.get(placed.key) === placed.key) {
        itemAt.set(placed.key, declarationsOfItem.length as ItemId);
        declarationsOfItem.push([]);
        canonical.push({ placed, entry });
      }
    }
  }
  for (const entry of withSymbols) {
    for (const placed of entry.placed) {
      const item = itemAt.get(canonicalKey.get(placed.key) ?? placed.key);
      if (item !== undefined) {
        itemAt.set(placed.key, item);
        declarationsOfItem[item]?.push(placed);
      }
    }
  }

  const inherited = inheritedNamesBySource(api, withSymbols);
  const shapeReaders = new Map(sources.map((source) => [source, new ShapeReader(source.checker)]));
  const items = canonical.map(({ placed, entry }): Item => {
    const declaration = placed.declaration;
    const parent = declaration.parent === undefined ? undefined : itemAt.get(keyOfNode(entry.source.sourceFile, declaration.parent.node));
    const file = files[entry.file];
    if (file === undefined) {
      throw new RangeError(`no file ${entry.file} in the layout`);
    }
    return {
      name: declaration.name,
      owner: file.module,
      file: entry.file,
      kind: declaration.kind,
      parent,
      implementsInheritedMember:
        declaration.memberOf !== undefined &&
        declaration.memberName !== "constructor" &&
        (inherited.get(declaration.memberOf)?.has(declaration.memberName) ?? false),
      takesThis: declaration.takesThis,
    };
  });
  return {
    items,
    itemAt,
    declarationsOf: declarationsOfItem,
    memberNames: new Set(canonical.map(({ placed }) => placed.declaration.memberName)),
    fieldShapes: fieldShapesOf(withSymbols, itemAt, shapeReaders),
    shapeReaders,
  };
}

function placeDeclarations(source: AnalyzedSource, file: FileId): Omit<SourceDeclarations, "symbols"> {
  const placed = declarationsOf(source.sourceFile).map((declaration) => ({
    declaration,
    source,
    key: keyOfNode(source.sourceFile, declaration.node),
  }));
  return { source, file, placed };
}

function symbolsOfNames(entry: Omit<SourceDeclarations, "symbols">): Map<PlacedDeclaration, CompilerSymbol> {
  const named = entry.placed.flatMap((placed) =>
    placed.declaration.symbolName === undefined ? [] : [{ placed, name: placed.declaration.symbolName }],
  );
  const symbols = new Map<PlacedDeclaration, CompilerSymbol>();
  if (named.length === 0) {
    return symbols;
  }
  const found = entry.source.checker.getSymbolAtLocation(named.map((each) => each.name));
  named.forEach((each, index) => {
    const symbol = found[index];
    if (symbol !== undefined) {
      symbols.set(each.placed, symbol);
    }
  });
  return symbols;
}

function inheritedNamesBySource(
  api: API,
  entries: readonly SourceDeclarations[],
): Map<ClassDeclaration, Set<string>> {
  const names = new Map<ClassDeclaration, Set<string>>();
  for (const entry of entries) {
    const classes = new Set<ClassDeclaration>();
    for (const placed of entry.placed) {
      if (placed.declaration.memberOf !== undefined) {
        classes.add(placed.declaration.memberOf);
      }
    }
    for (const [owner, inherited] of inheritedMemberNames(api, entry.source.checker, [...classes])) {
      names.set(owner, inherited);
    }
  }
  return names;
}

function fieldShapesOf(
  entries: readonly SourceDeclarations[],
  itemAt: ReadonlyMap<DeclarationKey, ItemId>,
  shapeReaders: ReadonlyMap<AnalyzedSource, ShapeReader>,
): Map<ItemId, ValueShape> {
  const shapes = new Map<ItemId, ValueShape>();
  for (const entry of entries) {
    const fields = entry.placed.flatMap((placed) => {
      const symbol = entry.symbols.get(placed);
      const item = itemAt.get(placed.key);
      return placed.declaration.kind === "field" && symbol !== undefined && item !== undefined && !shapes.has(item)
        ? [{ item, symbol }]
        : [];
    });
    const reader = shapeReaders.get(entry.source);
    if (fields.length === 0 || reader === undefined) {
      continue;
    }
    const types = entry.source.checker.getTypeOfSymbol(fields.map((field) => field.symbol));
    fields.forEach((field, index) => {
      const type = types[index];
      shapes.set(field.item, type === undefined ? "structured" : reader.shapeOf(type));
    });
  }
  return shapes;
}
