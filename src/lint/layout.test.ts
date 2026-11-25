import { test } from "node:test";
import assert from "node:assert/strict";
import type { TreeNode } from "../model/index.ts";
import { Sample } from "../model/sample.ts";
import { holders, layout } from "./layout.ts";

function letters(count: number): string[] {
  return [..."abcdefghijklmnopqrstuvwxyz"].slice(0, count);
}

function packageP(): Sample {
  const sample = new Sample();
  sample.file(sample.package(), "src/index.ts", 1);
  return sample;
}

function keys(sample: Sample, scope: TreeNode | undefined): string[] {
  return layout(sample.model, scope).map((diagnostic) => `${diagnostic.lint} ${diagnostic.key}`);
}

test("a directory of more than fifteen files and directories is wide", () => {
  const sample = packageP();
  for (const name of letters(14)) {
    sample.module(name);
  }
  assert.deepEqual(keys(sample, undefined), []);
  sample.module("o/p");
  const diagnostics = layout(sample.model, undefined);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    lint: "wide-directory",
    key: "src/",
    message: "`src/` is wide: it holds 16 files and directories, more than 15",
    location: { file: "src/index.ts", line: 1 },
    notes: ["15 files: a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, g.ts, +8 more", "1 directory: o/"],
    picture: { kind: "bar", label: "holds", length: 16, most: 15 },
  });
});

test("a wide directory is found where the file that stands for it is", () => {
  const sample = packageP();
  const store = sample.module("store");
  for (const name of letters(16)) {
    sample.file(store, `src/store/${name}.ts`, 1);
    sample.file(store, `tests/${name}.ts`, 1);
  }
  const location = (key: string): unknown => layout(sample.model, undefined).find((d) => d.key === key)?.location;
  assert.deepEqual(location("src/store/"), { file: "src/store.ts", line: 1 });
  assert.equal(location("tests/"), undefined);
  assert.ok(layout(sample.model, undefined).some((d) => d.key === "tests/"));
  sample.file(store, "src/store/index.ts", 1);
  assert.deepEqual(location("src/store/"), { file: "src/store/index.ts", line: 1 });
});

test("a file of more than 2000 lines is long", () => {
  const sample = packageP();
  sample.file(sample.package(), "src/table.ts", 2_000);
  assert.deepEqual(keys(sample, undefined), []);
  const last = sample.files.length - 1;
  const table = sample.files[last];
  assert.ok(table !== undefined);
  sample.files[last] = { ...table, lines: 2_001 };
  const diagnostics = layout(sample.model, undefined);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.key, "src/table.ts");
  assert.equal(diagnostics[0]?.message, "`src/table.ts` is long: it has 2001 lines, more than 2000");
});

test("a wide directory concerns what is below it and a long file its module", () => {
  const sample = packageP();
  const p = sample.package();
  const modules = letters(15).map((name) => sample.module(name));
  const a = sample.files[1];
  assert.ok(a !== undefined);
  sample.files[1] = { ...a, lines: 2_001 };
  const q = sample.tree.child(sample.tree.root, "package", "q");
  sample.file(q, "q/src/index.ts", 1);
  const both = ["long-file src/a.ts", "wide-directory src/"];
  assert.deepEqual(keys(sample, undefined), both);
  assert.deepEqual(keys(sample, p), both);
  assert.deepEqual(keys(sample, modules[0]), both);
  assert.deepEqual(keys(sample, modules[1]), ["wide-directory src/"]);
  assert.deepEqual(keys(sample, q), []);
});

test("a path is held by each directory above it", () => {
  assert.deepEqual(holders("src/lint/cycles.ts"), [
    { directory: "", member: "src/" },
    { directory: "src", member: "lint/" },
    { directory: "src/lint", member: "cycles.ts" },
  ]);
  assert.deepEqual(holders("eslint.config.ts"), [{ directory: "", member: "eslint.config.ts" }]);
});
