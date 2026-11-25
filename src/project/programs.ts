import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceFile } from "typescript/ast";
import { API, type Checker, type Project, type Snapshot } from "typescript/sync";
import { ToolError } from "../error.ts";
import { innermostPackage, isInside, type Workspace, type WorkspacePackage } from "./workspace.ts";

export interface AnalyzedSource {
  readonly fileName: string;
  readonly config: string;
  readonly package: WorkspacePackage;
  readonly path: string;
}

export interface CompilerSession {
  readonly api: API;
  readonly snapshot: Snapshot;
  readonly sources: readonly AnalyzedSource[];
}

interface OpenedProgram {
  readonly config: string;
  readonly project: Project;
  readonly package: WorkspacePackage | undefined;
}

interface SourceCandidate {
  readonly fileName: string;
  readonly path: string;
  readonly package: WorkspacePackage;
  readonly program: OpenedProgram;
}

const CONFIG_FILE = "tsconfig.json";
const TREES_KEPT_BY_THE_CLIENT = 200;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const DECLARATION_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];

export function openCompiler(workspace: Workspace): CompilerSession {
  const packageConfigs = workspace.packages
    .map((member) => join(member.directory, CONFIG_FILE))
    .filter((config) => existsSync(config));
  if (packageConfigs.length === 0) {
    throw new ToolError(`no ${CONFIG_FILE} in the packages of the workspace at ${workspace.root}`);
  }
  const api = new API({ cwd: workspace.root });
  try {
    const configs = withReferencedConfigs(api, packageConfigs);
    const snapshot = api.createSnapshot({ openProjects: configs });
    const programs: OpenedProgram[] = [];
    for (const config of configs) {
      const project = snapshot.getConfiguredProject(config);
      if (project !== undefined) {
        programs.push({ config, project, package: innermostPackage(workspace, config) });
      }
    }
    return { api, snapshot, sources: chosenSources(workspace, programs) };
  } catch (error) {
    api.close();
    throw error;
  }
}

export function eachTree<Entry extends { readonly source: AnalyzedSource }, Result>(
  session: CompilerSession,
  entries: readonly Entry[],
  read: (entry: Entry, tree: SourceFile, checker: Checker, index: number) => Result,
): Result[] {
  const results: Result[] = [];
  for (const [index, entry] of entries.entries()) {
    const project = session.snapshot.getConfiguredProject(entry.source.config);
    const tree = project?.program.getSourceFile(entry.source.fileName);
    if (project === undefined || tree === undefined) {
      throw new RangeError(`the compiler lost ${entry.source.fileName}`);
    }
    results.push(read(entry, tree, project.checker, index));
    if ((index + 1) % TREES_KEPT_BY_THE_CLIENT === 0) {
      session.api.clearSourceFileCache();
    }
  }
  session.api.clearSourceFileCache();
  return results;
}

function withReferencedConfigs(api: API, packageConfigs: readonly string[]): string[] {
  const opened = new Set<string>();
  const pending = [...packageConfigs];
  for (let config = pending.shift(); config !== undefined; config = pending.shift()) {
    if (opened.has(config)) {
      continue;
    }
    opened.add(config);
    for (const reference of api.parseConfigFile(config).projectReferences ?? []) {
      const referenced = configFileOf(reference.path);
      if (existsSync(referenced)) {
        pending.push(referenced);
      }
    }
  }
  return [...opened];
}

function configFileOf(referencePath: string): string {
  return existsSync(referencePath) && statSync(referencePath).isDirectory()
    ? join(referencePath, CONFIG_FILE)
    : referencePath;
}

function chosenSources(workspace: Workspace, programs: readonly OpenedProgram[]): AnalyzedSource[] {
  const chosen = new Map<string, SourceCandidate>();
  for (const program of programs) {
    for (const fileName of program.project.program.getSourceFileNames()) {
      const candidate = candidateOf(workspace, program, fileName);
      if (candidate === undefined) {
        continue;
      }
      const known = chosen.get(candidate.path);
      if (known === undefined || (known.program.package !== known.package && program.package === candidate.package)) {
        chosen.set(candidate.path, candidate);
      }
    }
  }
  const ignored = ignoredByGit(workspace.root, [...chosen.keys()]);
  return [...chosen.values()]
    .filter((candidate) => !ignored.has(candidate.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((candidate) => ({
      fileName: candidate.fileName,
      config: candidate.program.config,
      package: candidate.package,
      path: candidate.path,
    }));
}

function ignoredByGit(root: string, paths: readonly string[]): Set<string> {
  const check = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    input: paths.join("\0"),
    encoding: "utf8",
    maxBuffer: Number.MAX_SAFE_INTEGER,
  });
  return check.status === 0 ? new Set(check.stdout.split("\0").filter((path) => path !== "")) : new Set();
}

function candidateOf(workspace: Workspace, program: OpenedProgram, fileName: string): SourceCandidate | undefined {
  if (!isInside(workspace.root, fileName) || !isAnalyzedFileName(fileName)) {
    return undefined;
  }
  const path = relative(workspace.root, fileName).split(sep).join("/");
  if (path.split("/").some((part) => part === "node_modules" || part.startsWith("."))) {
    return undefined;
  }
  const owner = innermostPackage(workspace, fileName);
  return owner === undefined ? undefined : { fileName, path, package: owner, program };
}

function isAnalyzedFileName(fileName: string): boolean {
  return (
    SOURCE_EXTENSIONS.some((extension) => fileName.endsWith(extension)) &&
    !DECLARATION_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  );
}
