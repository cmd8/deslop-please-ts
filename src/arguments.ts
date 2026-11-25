import { TOOL } from "./tool.ts";

export interface Options {
  readonly scope: string | undefined;
  readonly allow: string | undefined;
  readonly updateAllow: string | undefined;
}

export type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: Options }
  | { readonly kind: "usage-error"; readonly message: string };

type Flag = "--allow" | "--update-allow";

const FLAGS: readonly Flag[] = ["--allow", "--update-allow"];

const HELP_WORDS = new Set(["-h", "--help", "help"]);

export function usage(): string {
  return `usage: ${TOOL} [package_or_module] [--allow <path>] [--update-allow <path>]

Runs architectural lints (module-cycle, tangle, field-leak, shallow-module,
wide-directory, long-file) on the TypeScript workspace.

options:
  <package_or_module>          check only one package or module (e.g. my-package)
  --allow <path>               suppress listed existing debt; new errors still fail
  --update-allow <path>        write current diagnostics to <path>

A flag's value is the next word, or follows \`=\`: \`--allow=<path>\`.
`;
}

export function parseArguments(words: readonly string[]): ParsedArguments {
  const [only, ...rest] = words;
  if (only !== undefined && rest.length === 0 && HELP_WORDS.has(only)) {
    return { kind: "help" };
  }
  let scope: string | undefined;
  const values = new Map<Flag, string>();
  const error = (message: string): ParsedArguments => ({ kind: "usage-error", message });
  const remaining = [...words];
  for (let word = remaining.shift(); word !== undefined; word = remaining.shift()) {
    if (!word.startsWith("-")) {
      if (scope !== undefined) {
        return error(`unexpected argument '${word}'`);
      }
      scope = word;
      continue;
    }
    const equals = word.indexOf("=");
    const written = equals < 0 ? word : word.slice(0, equals);
    const flag = FLAGS.find((known) => known === written);
    if (flag === undefined) {
      return error(`unexpected argument '${word}'`);
    }
    if (values.has(flag)) {
      return error(`'${flag}' cannot be given more than once`);
    }
    const [next] = remaining;
    if (equals >= 0) {
      values.set(flag, word.slice(equals + 1));
    } else if (next !== undefined && !next.startsWith("-")) {
      values.set(flag, next);
      remaining.shift();
    } else {
      return error(`'${flag}' needs a value`);
    }
  }
  if (values.has("--allow") && values.has("--update-allow")) {
    return error("'--allow' and '--update-allow' cannot be given together");
  }
  return {
    kind: "options",
    options: { scope, allow: values.get("--allow"), updateAllow: values.get("--update-allow") },
  };
}
