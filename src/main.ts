#!/usr/bin/env node
import { AllowList } from "./allow.ts";
import { parseArguments, usage } from "./arguments.ts";
import type { Options } from "./arguments.ts";
import { ToolError } from "./error.ts";
import { check, resolveNode } from "./lint/index.ts";
import { readProject } from "./project/index.ts";
import { render } from "./report/index.ts";
import { TOOL } from "./tool.ts";

const EXIT_CLEAN = 0;
const EXIT_REPORTED = 1;
const EXIT_USAGE_OR_TOOL_ERROR = 2;

function run(options: Options): number {
  const model = readProject(process.cwd());
  const query = options.scope;
  const scope = query === undefined ? undefined : resolveNode(model, query);
  if (query !== undefined && scope === undefined) {
    throw new ToolError(`${query}: no such package or module`);
  }
  const all = check(model, scope);
  if (options.updateAllow !== undefined) {
    AllowList.fromDiagnostics(all).write(options.updateAllow);
    process.stderr.write(`${TOOL}: wrote ${all.length} entries to ${options.updateAllow}\n`);
    return EXIT_CLEAN;
  }
  const allow = options.allow === undefined ? undefined : AllowList.read(options.allow);
  const reported = allow === undefined ? all : all.filter((diagnostic) => !allow.isAllowed(diagnostic));
  const fixedAllowed = allow === undefined ? 0 : allow.fixedCount(all);
  process.stdout.write(render(reported, fixedAllowed, options.allow));
  return reported.length === 0 ? EXIT_CLEAN : EXIT_REPORTED;
}

function main(words: readonly string[]): number {
  const parsed = parseArguments(words);
  switch (parsed.kind) {
    case "help":
      process.stdout.write(usage());
      return EXIT_CLEAN;
    case "usage-error":
      process.stderr.write(`${TOOL}: ${parsed.message}\n${usage()}`);
      return EXIT_USAGE_OR_TOOL_ERROR;
    case "options":
      try {
        return run(parsed.options);
      } catch (error) {
        if (error instanceof ToolError) {
          process.stderr.write(`${TOOL}: ${error.message}\n`);
          return EXIT_USAGE_OR_TOOL_ERROR;
        }
        throw error;
      }
  }
}

process.exitCode = main(process.argv.slice(2));
