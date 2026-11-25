import { isCallExpression, isPropertyAccessExpression, type Node, type SourceFile } from "typescript/ast";
import type { CodeFile, Item, Reference, Wrapper } from "../model/index.ts";
import { accessUseOf, onlyReadsValue, type AccessUse } from "./access.ts";
import type { Catalog } from "./catalog.ts";
import type { NameRole, ResolvedName } from "./resolution.ts";
import { widestShape } from "./valueShape.ts";

export interface FileContext {
  readonly file: CodeFile;
  readonly tree: SourceFile;
  readonly holders: ReadonlyMap<Node, Item>;
}

export interface PendingReference {
  readonly reference: Omit<Reference, "onlyReadsValue">;
  readonly role: NameRole;
  readonly accessUse: AccessUse | undefined;
  readonly callUse: AccessUse | undefined;
}

export function referencesIn(context: FileContext, names: readonly ResolvedName[]): PendingReference[] {
  const holderAt = new Map<Node, Item | undefined>();
  const holderOf = (node: Node): Item | undefined => {
    const visited: Node[] = [];
    let found: Item | undefined;
    for (let at: Node | undefined = node.parent; at !== undefined; at = at.parent) {
      if (holderAt.has(at)) {
        found = holderAt.get(at);
        break;
      }
      visited.push(at);
      found = context.holders.get(at);
      if (found !== undefined || at === context.tree) {
        break;
      }
    }
    for (const each of visited) {
      holderAt.set(each, found);
    }
    return found;
  };
  const tree = context.tree;
  return names.map((name) => {
    const access = name.role === "destructured" ? undefined : memberAccessOf(name.node);
    const call = access === undefined ? undefined : callOf(access);
    return {
      reference: {
        file: context.file,
        line: tree.getLineAndCharacterOfPosition(name.node.getStart(tree)).line + 1,
        from: context.file.module,
        holder: holderOf(name.node),
        item: name.item,
        test: context.file.test,
      },
      role: name.role,
      accessUse: access === undefined ? undefined : accessUseOf(access),
      callUse: call === undefined ? undefined : accessUseOf(call),
    };
  });
}

export function finishedReference(
  pending: PendingReference,
  catalog: Catalog,
  wrappers: ReadonlyMap<Item, Wrapper>,
): Reference {
  return { ...pending.reference, onlyReadsValue: readsOnlyValue(pending, catalog, wrappers) };
}

function readsOnlyValue(pending: PendingReference, catalog: Catalog, wrappers: ReadonlyMap<Item, Wrapper>): boolean {
  if (pending.role === "destructured") {
    return true;
  }
  const item = pending.reference.item;
  if (pending.accessUse === undefined) {
    return false;
  }
  if (item.kind === "field") {
    return onlyReadsValue(pending.accessUse, catalog.fieldShapes.get(item) ?? "structured");
  }
  const wrapper = wrappers.get(item);
  if (wrapper?.kind !== "accessor" || !wrapper.lendsOnlyToRead) {
    return false;
  }
  const use = isPropertyLike(catalog, item) ? pending.accessUse : pending.callUse;
  if (use === undefined) {
    return false;
  }
  const shape = widestShape(
    [...wrapper.lent, ...wrapper.copied].map((field) => catalog.fieldShapes.get(field) ?? "structured"),
  );
  return onlyReadsValue(use, shape);
}

function memberAccessOf(node: Node): Node | undefined {
  const parent = node.parent;
  return isPropertyAccessExpression(parent) && parent.name === node ? parent : undefined;
}

function callOf(access: Node): Node | undefined {
  const parent = access.parent;
  return isCallExpression(parent) && parent.expression === access ? parent : undefined;
}

function isPropertyLike(catalog: Catalog, item: Item): boolean {
  return (catalog.declarationsOf.get(item) ?? []).some((declaration) => declaration.form === "accessor");
}
