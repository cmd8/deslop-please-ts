import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ToolError } from "./error.ts";
import { compareLints, compareText, parseLint } from "./lint/index.ts";
import type { Diagnostic, Lint } from "./lint/index.ts";
import { TOOL } from "./tool.ts";

interface AllowEntry {
  readonly lint: Lint;
  readonly key: string;
}

export type ParsedAllowList =
  | { readonly kind: "parsed"; readonly allowList: AllowList }
  | { readonly kind: "invalid"; readonly line: number };

export class AllowList {
  readonly #entries: readonly AllowEntry[];

  private constructor(entries: readonly AllowEntry[]) {
    const unique = new Map(entries.map((entry) => [`${entry.lint} ${entry.key}`, entry]));
    this.#entries = [...unique.values()].sort((a, b) => compareLints(a.lint, b.lint) || compareText(a.key, b.key));
  }

  static fromDiagnostics(diagnostics: readonly Diagnostic[]): AllowList {
    return new AllowList(diagnostics.map(({ lint, key }) => ({ lint, key })));
  }

  static read(path: string): AllowList {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new ToolError(`${path}: ${messageOf(error)}`);
    }
    const parsed = AllowList.parse(text);
    switch (parsed.kind) {
      case "parsed":
        return parsed.allowList;
      case "invalid":
        throw new ToolError(`${path}:${parsed.line}: invalid allowlist entry`);
    }
  }

  static parse(text: string): ParsedAllowList {
    const entries: AllowEntry[] = [];
    for (const [index, line] of text.split("\n").entries()) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }
      const space = trimmed.indexOf(" ");
      const lint = space < 0 ? undefined : parseLint(trimmed.slice(0, space));
      const key = trimmed.slice(space + 1).trim();
      if (lint === undefined || key === "") {
        return { kind: "invalid", line: index + 1 };
      }
      entries.push({ lint, key });
    }
    return { kind: "parsed", allowList: new AllowList(entries) };
  }

  write(path: string): void {
    const parent = dirname(path);
    try {
      mkdirSync(parent, { recursive: true });
    } catch (error) {
      throw new ToolError(`${parent}: ${messageOf(error)}`);
    }
    try {
      writeFileSync(path, this.toText());
    } catch (error) {
      throw new ToolError(`${path}: ${messageOf(error)}`);
    }
  }

  toText(): string {
    const header =
      `# Existing architectural debt suppressed by \`${TOOL} --allow\`.\n` +
      "# Fixing an entry here never fails CI; new issues not listed here fail.\n";
    return header + this.#entries.map(({ lint, key }) => `${lint} ${key}\n`).join("");
  }

  isAllowed(diagnostic: Diagnostic): boolean {
    return this.#entries.some((entry) => covers(entry, diagnostic));
  }

  fixedCount(diagnostics: readonly Diagnostic[]): number {
    return this.#entries.filter((entry) => !diagnostics.some((diagnostic) => covers(entry, diagnostic))).length;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function covers({ lint, key }: AllowEntry, diagnostic: Diagnostic): boolean {
  if (diagnostic.lint !== lint) {
    return false;
  }
  if (diagnostic.key === key) {
    return true;
  }
  const allowed = circleMembers(key);
  return (
    (lint === "tangle" || lint === "module-cycle") &&
    circleMembers(diagnostic.key).every((member) => allowed.includes(member))
  );
}

const OPENING_BRACKETS = new Set(["<", "(", "["]);
const CLOSING_BRACKETS = new Set([">", ")", "]"]);

function circleMembers(key: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < key.length; at += 1) {
    const character = key.charAt(at);
    if (OPENING_BRACKETS.has(character)) {
      depth += 1;
    } else if (CLOSING_BRACKETS.has(character)) {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      members.push(key.slice(start, at));
      start = at + 1;
    }
  }
  members.push(key.slice(start));
  return members;
}
