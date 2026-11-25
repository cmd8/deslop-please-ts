import { relative, sep } from "node:path";
import { Tree, type CodeFile, type NodeId } from "../model/index.ts";
import type { AnalyzedSource } from "./programs.ts";
import { innermostPackage, type Workspace, type WorkspacePackage } from "./workspace.ts";

export interface PlacedSource {
  readonly source: AnalyzedSource;
  readonly file: CodeFile;
}

export interface Layout {
  readonly tree: Tree;
  readonly placed: readonly PlacedSource[];
}

const INDEX_FILE = /^index\.(ts|tsx|mts|cts)$/;
const TEST_FILE = /\.(test|spec|stories)\.(ts|tsx|mts|cts)$/;
const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts)$/;
const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__", "__mocks__"]);

export interface CountedSource {
  readonly source: AnalyzedSource;
  readonly lines: number;
}

export function layOut(workspace: Workspace, sources: readonly CountedSource[]): Layout {
  const tree = new Tree();
  const packageNodes = packageNodesOf(workspace, tree);
  const placed = sources.map(({ source, lines }): PlacedSource => {
    const packageNode = packageNodes.get(source.package);
    if (packageNode === undefined) {
      throw new RangeError(`no node for the package at ${source.package.directory}`);
    }
    const placement = placeInPackage(tree, packageNode, source);
    return {
      source,
      file: { path: source.path, module: placement.module, test: placement.test, lines },
    };
  });
  return { tree, placed };
}

export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

function packageNodesOf(workspace: Workspace, tree: Tree): Map<WorkspacePackage, NodeId> {
  const nodes = new Map<WorkspacePackage, NodeId>();
  const outermostFirst = [...workspace.packages].sort(
    (a, b) => a.directory.split(sep).length - b.directory.split(sep).length,
  );
  for (const member of outermostFirst) {
    const around = innermostPackage(
      { root: workspace.root, packages: workspace.packages.filter((other) => other !== member) },
      member.directory,
    );
    const parent = around === undefined ? tree.root : nodes.get(around);
    if (parent === undefined) {
      throw new RangeError(`no node for the package at ${around?.directory ?? workspace.root}`);
    }
    nodes.set(member, tree.child(parent, "package", member.name));
  }
  return nodes;
}

function placeInPackage(
  tree: Tree,
  packageNode: NodeId,
  source: AnalyzedSource,
): { readonly module: NodeId; readonly test: boolean } {
  const parts = relative(source.package.directory, joinedPath(source)).split(sep);
  const fileName = parts.pop() ?? "";
  let module = packageNode;
  let inTestDirectory = false;
  for (const directory of parts) {
    module = tree.child(module, "module", directory);
    if (TEST_DIRECTORIES.has(directory)) {
      inTestDirectory = true;
      tree.markAsTestCode(module);
    }
  }
  if (!INDEX_FILE.test(fileName)) {
    module = tree.child(module, "module", fileName.replace(SOURCE_EXTENSION, ""));
  }
  const test = inTestDirectory || TEST_FILE.test(fileName);
  if (test) {
    tree.markAsTestCode(module);
  }
  return { module, test };
}

function joinedPath(source: AnalyzedSource): string {
  return source.fileName.split("/").join(sep);
}
