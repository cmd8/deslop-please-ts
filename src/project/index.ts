import type { FileId, ItemId, Model } from "../model/index.ts";
import { catalogItems, type PlacedDeclaration } from "./catalog.ts";
import { layOut } from "./layout.ts";
import { openCompiler, type AnalyzedSource } from "./programs.ts";
import { referencesIn } from "./references.ts";
import { NameResolver, type ResolvedName } from "./resolution.ts";
import { nodeIndex } from "./syntax.ts";
import { findWrappers } from "./wrappers.ts";
import { findWorkspace } from "./workspace.ts";

export function readProject(workingDirectory: string): Model {
  const workspace = findWorkspace(workingDirectory);
  const session = openCompiler(workspace);
  try {
    const { tree, files } = layOut(workspace, session.sources);
    const catalog = catalogItems(session.api, session.sources, files);
    const resolver = new NameResolver(session.api, catalog);
    const resolved = session.sources.map((source) => resolver.resolve(source));
    const namedItems = namedItemsBySource(session.sources, resolved);
    const wrappers = findWrappers(catalog, (declaration: PlacedDeclaration, node) =>
      namedItems.get(declaration.source)?.get(nodeIndex(node)),
    );
    const references = session.sources.flatMap((source, index) => {
      const file = files[index];
      return file === undefined
        ? []
        : referencesIn({ id: index as FileId, file, source }, resolved[index] ?? [], catalog, wrappers);
    });
    return { tree, files, items: catalog.items, references, wrappers };
  } finally {
    session.api.close();
  }
}

function namedItemsBySource(
  sources: readonly AnalyzedSource[],
  resolved: readonly (readonly ResolvedName[])[],
): Map<AnalyzedSource, Map<number, ItemId>> {
  return new Map(
    sources.map((source, index) => [
      source,
      new Map(
        (resolved[index] ?? []).filter((name) => name.role === "named").map((name) => [nodeIndex(name.node), name.item]),
      ),
    ]),
  );
}
