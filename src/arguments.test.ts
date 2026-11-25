import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArguments } from "./arguments.ts";
import type { Options } from "./arguments.ts";

function options(words: readonly string[]): Options {
  const parsed = parseArguments(words);
  assert.ok(parsed.kind === "options", JSON.stringify(parsed));
  return parsed.options;
}

test("a scope alone is read as the package or module to check", () => {
  assert.deepEqual(options(["my-package"]), { scope: "my-package", allow: undefined, updateAllow: undefined });
});

test("a value follows its flag or an equals sign in it", () => {
  for (const words of [
    ["my-package", "--allow", "a.allow"],
    ["--allow=a.allow", "my-package"],
  ]) {
    assert.deepEqual(options(words), { scope: "my-package", allow: "a.allow", updateAllow: undefined });
  }
  for (const words of [["--update-allow", "b.allow"], ["--update-allow=b.allow"]]) {
    assert.equal(options(words).updateAllow, "b.allow");
  }
});

test("help is asked for by one word alone", () => {
  for (const word of ["-h", "--help", "help"]) {
    assert.deepEqual(parseArguments([word]), { kind: "help" });
  }
  assert.equal(parseArguments(["--help", "my-package"]).kind, "usage-error");
});

test("what the command line cannot mean is an error", () => {
  for (const words of [
    ["--allow"],
    ["--allow", "--update-allow", "b"],
    ["--allow", "a", "--allow", "b"],
    ["--allow", "a", "--update-allow", "b"],
    ["--release"],
    ["--target", "x"],
    ["-p", "my-package"],
    ["my-package", "other-package"],
  ]) {
    assert.equal(parseArguments(words).kind, "usage-error", JSON.stringify(words));
  }
});
