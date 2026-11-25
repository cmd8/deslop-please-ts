import type { Node, SourceFile } from "typescript/ast";
import type { Checker } from "typescript/sync";
import type { CodeFile, Item, Model } from "../model/index.ts";
import { catalogItems, recordSource, type Catalog, type DeclarationRecord } from "./catalog.ts";
import { declarationsOf } from "./declarations.ts";
import { layOut, lineCount } from "./layout.ts";
import { eachTree, openCompiler } from "./programs.ts";
import { finishedReference, referencesIn, type PendingReference } from "./references.ts";
import { NameResolver, type ResolvedName } from "./resolution.ts";
import { ShapeReader } from "./valueShape.ts";
import { assembleWrappers, wrappingOf, type BodyWrapping } from "./wrappers.ts";
import { findWorkspace } from "./workspace.ts";

interface ReadFile {
  readonly references: readonly PendingReference[];
  readonly wrappings: readonly (readonly [DeclarationRecord, BodyWrapping])[];
}

export function readProject(workingDirectory: string): Model {
  const workspace = findWorkspace(workingDirectory);
  const session = openCompiler(workspace);
  try {
    const shapeReaders = new WeakMap<Checker, ShapeReader>();
    const readerOf = (checker: Checker) => {
      const reader = shapeReaders.get(checker) ?? new ShapeReader(checker);
      shapeReaders.set(checker, reader);
      return reader;
    };
    const recorded = eachTree(session, session.sources.map((source) => ({ source })), ({ source }, tree, checker) => ({
      source,
      lines: lineCount(tree.text),
      record: recordSource(session.api, checker, readerOf(checker), tree),
    }));
    const { tree, placed } = layOut(workspace, recorded);
    const files = placed.map((each) => each.file);
    const catalog = catalogItems(placed);
    const resolver = new NameResolver(session.api, catalog);
    const read = eachTree(session, placed, ({ file }, sourceTree, checker) =>
      readFile(catalog, resolver, checker, sourceTree, file),
    );
    const wrappers = assembleWrappers(catalog, new Map(read.flatMap((each) => each.wrappings)));
    const references = read.flatMap((each) =>
      each.references.map((pending) => finishedReference(pending, catalog, wrappers)),
    );
    return { tree, files, items: catalog.items, references, wrappers };
  } finally {
    session.api.close();
  }
}

function readFile(
  catalog: Catalog,
  resolver: NameResolver,
  checker: Checker,
  tree: SourceFile,
  file: CodeFile,
): ReadFile {
  const names = resolver.resolve(checker, tree);
  const named = namedItems(names);
  const wrappings = declarationsOf(tree).flatMap((declaration): (readonly [DeclarationRecord, BodyWrapping])[] => {
    const record = catalog.declarationAt(tree.path, declaration.node);
    const item = catalog.itemAt(tree.path, declaration.node);
    const wrapping =
      item === undefined ? undefined : wrappingOf(catalog, declaration.node, item, (node) => named.get(node));
    return record === undefined || wrapping === undefined ? [] : [[record, wrapping]];
  });
  return {
    references: referencesIn({ file, tree }, names, catalog),
    wrappings,
  };
}

function namedItems(names: readonly ResolvedName[]): Map<Node, Item> {
  const items = new Map<Node, Item>();
  for (const name of names) {
    if (name.role === "named" && !items.has(name.node)) {
      items.set(name.node, name.item);
    }
  }
  return items;
}
