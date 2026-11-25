import type { CodeFile, Model, TreeNode } from "../model/index.ts";
import { compareText } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { INDEX_FILE_NAMES, TYPESCRIPT_EXTENSIONS, inScope, listed } from "./reporting.ts";

const MOST_MEMBERS_OF_A_DIRECTORY = 15;

const MOST_LINES_OF_A_FILE = 2_000;

interface DirectoryMembers {
  readonly members: Set<string>;
  concerned: boolean;
}

export function layout(model: Model, scope: TreeNode | undefined): Diagnostic[] {
  const concerned = (file: CodeFile): boolean => inScope(model.tree, scope, file.module);
  const diagnostics = model.files
    .filter((file) => file.lines > MOST_LINES_OF_A_FILE && concerned(file))
    .map(longFile);
  const directories = new Map<string, DirectoryMembers>();
  for (const file of model.files) {
    for (const { directory, member } of holders(file.path)) {
      const held = directories.get(directory) ?? { members: new Set<string>(), concerned: false };
      directories.set(directory, held);
      held.members.add(member);
      held.concerned ||= concerned(file);
    }
  }
  const wide = [...directories]
    .filter(([, held]) => held.concerned && held.members.size > MOST_MEMBERS_OF_A_DIRECTORY)
    .sort(([a], [b]) => compareText(a, b))
    .map(([directory, held]) => wideDirectory(model, directory, held.members));
  return [...diagnostics, ...wide];
}

export interface Holder {
  readonly directory: string;
  readonly member: string;
}

export function holders(path: string): Holder[] {
  const held: Holder[] = [];
  let start = 0;
  for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", start)) {
    held.push({ directory: path.slice(0, Math.max(0, start - 1)), member: path.slice(start, slash + 1) });
    start = slash + 1;
  }
  held.push({ directory: path.slice(0, Math.max(0, start - 1)), member: path.slice(start) });
  return held;
}

function longFile(file: CodeFile): Diagnostic {
  return {
    lint: "long-file",
    key: file.path,
    message: `\`${file.path}\` is long: it has ${file.lines} lines, more than ${MOST_LINES_OF_A_FILE}`,
    location: { file: file.path, line: 1 },
    notes: [],
    picture: { kind: "bar", label: "lines", length: file.lines, most: MOST_LINES_OF_A_FILE },
  };
}

function wideDirectory(model: Model, directory: string, members: ReadonlySet<string>): Diagnostic {
  const inside = directory === "" ? "" : `${directory}/`;
  const shown = directory === "" ? "./" : inside;
  const sorted = [...members].sort(compareText);
  const notes = [
    { names: sorted.filter((member) => !member.endsWith("/")), one: "file", many: "files" },
    { names: sorted.filter((member) => member.endsWith("/")), one: "directory", many: "directories" },
  ]
    .filter(({ names }) => names.length > 0)
    .map(({ names, one, many }) => `${names.length} ${names.length === 1 ? one : many}: ${listed(names)}`);
  const index = INDEX_FILE_NAMES.find((name) => members.has(name));
  const beside =
    directory === ""
      ? undefined
      : TYPESCRIPT_EXTENSIONS.map((extension) => `${directory}${extension}`).find((path) =>
          model.files.some((file) => file.path === path),
        );
  const standsForDirectory = index === undefined ? beside : `${inside}${index}`;
  return {
    lint: "wide-directory",
    key: shown,
    message: `\`${shown}\` is wide: it holds ${members.size} files and directories, more than ${MOST_MEMBERS_OF_A_DIRECTORY}`,
    location: standsForDirectory === undefined ? undefined : { file: standsForDirectory, line: 1 },
    notes,
    picture: { kind: "bar", label: "holds", length: members.size, most: MOST_MEMBERS_OF_A_DIRECTORY },
  };
}
