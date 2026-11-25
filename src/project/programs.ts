import { existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceFile } from "typescript/ast";
import { API, type Checker, type Project } from "typescript/sync";
import { ToolError } from "../error.ts";
import { innermostPackage, isInside, type Workspace, type WorkspacePackage } from "./workspace.ts";

export interface AnalyzedSource {
  readonly sourceFile: SourceFile;
  readonly checker: Checker;
  readonly package: WorkspacePackage;
  readonly path: string;
}

export interface CompilerSession {
  readonly api: API;
  readonly sources: readonly AnalyzedSource[];
}

interface OpenedProgram {
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
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const DECLARATION_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];

export function openCompiler(workspace: Workspace): CompilerSession {
  const packageConfigs = workspace.packages
    .map((member) => join(member.directory, CONFIG_FILE))
    .filter((config) => existsSync(config));
  if (packageConfigs.length === 0) {
    throw new ToolError(`no ${CONFIG_FILE} in any package of the workspace at ${workspace.root}`);
  }
  const api = new API({ cwd: workspace.root });
  try {
    const configs = withReferencedConfigs(api, packageConfigs);
    const snapshot = api.createSnapshot({ openProjects: configs });
    const programs: OpenedProgram[] = [];
    for (const config of configs) {
      const project = snapshot.getConfiguredProject(config);
      if (project !== undefined) {
        programs.push({ project, package: innermostPackage(workspace, config) });
      }
    }
    return { api, sources: chosenSources(workspace, programs) };
  } catch (error) {
    api.close();
    throw error;
  }
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
  return [...chosen.values()]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .flatMap((candidate) => {
      const sourceFile = candidate.program.project.program.getSourceFile(candidate.fileName);
      return sourceFile === undefined
        ? []
        : [{ sourceFile, checker: candidate.program.project.checker, package: candidate.package, path: candidate.path }];
    });
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
