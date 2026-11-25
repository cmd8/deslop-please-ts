import {
  isCallExpression,
  isGetAccessorDeclaration,
  isPropertyAccessExpression,
  isSetAccessorDeclaration,
  type Node,
} from "typescript/ast";
import type { CodeFile, FileId, ItemId, Reference, Wrapper } from "../model/index.ts";
import { accessUseOf, onlyReadsValue } from "./access.ts";
import type { Catalog } from "./catalog.ts";
import type { AnalyzedSource } from "./programs.ts";
import type { ResolvedName } from "./resolution.ts";
import { keyOfNode, nodeIndex } from "./syntax.ts";
import { widestShape } from "./valueShape.ts";

export interface FileContext {
  readonly id: FileId;
  readonly file: CodeFile;
  readonly source: AnalyzedSource;
}

export function referencesIn(
  context: FileContext,
  names: readonly ResolvedName[],
  catalog: Catalog,
  wrappers: ReadonlyMap<ItemId, Wrapper>,
): Reference[] {
  const holderAt = new Map<number, ItemId | undefined>();
  const holderOf = (node: Node): ItemId | undefined => {
    const visited: number[] = [];
    let found: ItemId | undefined;
    for (let at: Node | undefined = node.parent; at !== undefined; at = at.parent) {
      const index = nodeIndex(at);
      if (holderAt.has(index)) {
        found = holderAt.get(index);
        break;
      }
      visited.push(index);
      found = catalog.itemAt.get(keyOfNode(context.source.sourceFile, at));
      if (found !== undefined || at === context.source.sourceFile) {
        break;
      }
    }
    for (const index of visited) {
      holderAt.set(index, found);
    }
    return found;
  };
  const sourceFile = context.source.sourceFile;
  return names.map((name) => ({
    file: context.id,
    line: sourceFile.getLineAndCharacterOfPosition(name.node.getStart(sourceFile)).line + 1,
    from: context.file.module,
    holder: holderOf(name.node),
    item: name.item,
    onlyReadsValue: readsOnlyValue(name, catalog, wrappers),
    test: context.file.test,
  }));
}

function readsOnlyValue(name: ResolvedName, catalog: Catalog, wrappers: ReadonlyMap<ItemId, Wrapper>): boolean {
  if (name.role === "destructured") {
    return true;
  }
  const access = memberAccessOf(name.node);
  if (access === undefined) {
    return false;
  }
  if (catalog.items[name.item]?.kind === "field") {
    return onlyReadsValue(accessUseOf(access), catalog.fieldShapes.get(name.item) ?? "structured");
  }
  const wrapper = wrappers.get(name.item);
  if (wrapper?.kind !== "accessor" || !wrapper.lendsOnlyToRead) {
    return false;
  }
  const result = isPropertyLike(catalog, name.item) ? access : callOf(access);
  if (result === undefined) {
    return false;
  }
  const shape = widestShape(
    [...wrapper.lent, ...wrapper.copied].map((field) => catalog.fieldShapes.get(field) ?? "structured"),
  );
  return onlyReadsValue(accessUseOf(result), shape);
}

function memberAccessOf(node: Node): Node | undefined {
  const parent = node.parent;
  return isPropertyAccessExpression(parent) && nodeIndex(parent.name) === nodeIndex(node) ? parent : undefined;
}

function callOf(access: Node): Node | undefined {
  const parent = access.parent;
  return isCallExpression(parent) && nodeIndex(parent.expression) === nodeIndex(access) ? parent : undefined;
}

function isPropertyLike(catalog: Catalog, item: ItemId): boolean {
  return (catalog.declarationsOf[item] ?? []).some(
    (placed) => isGetAccessorDeclaration(placed.declaration.node) || isSetAccessorDeclaration(placed.declaration.node),
  );
}
