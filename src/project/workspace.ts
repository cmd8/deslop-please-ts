import { existsSync, globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ToolError } from "../error.ts";

export interface WorkspacePackage {
  readonly directory: string;
  readonly name: string;
}

export interface Workspace {
  readonly root: string;
  readonly packages: readonly WorkspacePackage[];
}

interface PackageManifest {
  readonly name: string | undefined;
  readonly workspaces: readonly string[] | undefined;
}

const PATTERNS = z.array(z.string());

const PACKAGE_MANIFEST_SCHEMA = z.object({
  name: z.string().optional(),
  workspaces: z.union([PATTERNS, z.object({ packages: PATTERNS.optional() })]).optional(),
});

const PNPM_WORKSPACE_SCHEMA = z.object({ packages: PATTERNS.optional() }).nullable();

const PACKAGE_MANIFEST = "package.json";
const PNPM_WORKSPACE = "pnpm-workspace.yaml";

export function findWorkspace(workingDirectory: string): Workspace {
  const start = existingDirectory(workingDirectory);
  const root = workspaceRootAbove(start);
  const rootManifest = readManifest(root);
  const memberPatterns = existsSync(join(root, PNPM_WORKSPACE))
    ? readPnpmPatterns(join(root, PNPM_WORKSPACE))
    : (rootManifest?.workspaces ?? []);
  const packages: WorkspacePackage[] = [];
  if (rootManifest !== undefined) {
    packages.push({ directory: root, name: rootManifest.name ?? basename(root) });
  }
  for (const directory of memberDirectories(root, memberPatterns)) {
    const manifest = readManifest(directory);
    if (manifest !== undefined && directory !== root) {
      packages.push({ directory, name: manifest.name ?? basename(directory) });
    }
  }
  return { root, packages };
}

export function innermostPackage(
  workspace: Workspace,
  path: string,
): WorkspacePackage | undefined {
  let found: WorkspacePackage | undefined;
  for (const candidate of workspace.packages) {
    if (isInside(candidate.directory, path) && (found === undefined || isInside(found.directory, candidate.directory))) {
      found = candidate;
    }
  }
  return found;
}

export function isInside(directory: string, path: string): boolean {
  const between = relative(directory, path);
  return between === "" || (!between.startsWith("..") && !between.startsWith(sep) && !/^[A-Za-z]:/.test(between));
}

function existingDirectory(workingDirectory: string): string {
  const notAProject = new ToolError(`not inside a TypeScript project: ${workingDirectory} is no directory`);
  if (!existsSync(workingDirectory) || !statSync(workingDirectory).isDirectory()) {
    throw notAProject;
  }
  return realpathSync(workingDirectory);
}

function workspaceRootAbove(start: string): string {
  let nearestPackage: string | undefined;
  for (let directory = start; ; directory = dirname(directory)) {
    if (existsSync(join(directory, PNPM_WORKSPACE))) {
      return directory;
    }
    const manifest = readManifest(directory);
    if (manifest !== undefined) {
      if (manifest.workspaces !== undefined) {
        return directory;
      }
      nearestPackage ??= directory;
    }
    if (dirname(directory) === directory) {
      break;
    }
  }
  if (nearestPackage === undefined) {
    throw new ToolError(
      `not inside a TypeScript project: no ${PACKAGE_MANIFEST} in ${start} or a directory above it`,
    );
  }
  return nearestPackage;
}

function readManifest(directory: string): PackageManifest | undefined {
  const path = join(directory, PACKAGE_MANIFEST);
  if (!existsSync(path)) {
    return undefined;
  }
  const manifest = parsedJson(path, PACKAGE_MANIFEST_SCHEMA);
  const workspaces = manifest.workspaces;
  return {
    name: manifest.name,
    workspaces: workspaces === undefined || Array.isArray(workspaces) ? workspaces : workspaces.packages,
  };
}

function readPnpmPatterns(path: string): readonly string[] {
  return dataOf(path, PNPM_WORKSPACE_SCHEMA.safeParse(parseYaml(readText(path))))?.packages ?? [];
}

function dataOf<Data>(path: string, result: z.ZodSafeParseResult<Data>): Data {
  if (!result.success) {
    throw new ToolError(`${path} has an unexpected form:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function memberDirectories(root: string, patterns: readonly string[]): string[] {
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excluded = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  const matches = (globs: readonly string[]) =>
    globs.length === 0
      ? new Set<string>()
      : new Set(globSync(globs.map(withoutTrailingSlash), { cwd: root }).map((match) => join(root, match)));
  const left = matches(excluded);
  return [...matches(included)]
    .filter((directory) => !left.has(directory))
    .filter((directory) => !relative(root, directory).split(sep).includes("node_modules"))
    .filter((directory) => statSync(directory).isDirectory())
    .sort();
}

function withoutTrailingSlash(pattern: string): string {
  return pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    throw new ToolError(`cannot read ${path}: ${error.message}`);
  }
}

function parsedJson<Data>(path: string, schema: z.ZodType<Data>): Data {
  const text = readText(path);
  try {
    return dataOf(path, schema.safeParse(JSON.parse(text)));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new ToolError(`cannot read ${path}: ${error.message}`);
  }
}
