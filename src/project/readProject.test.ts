import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { after, describe, test } from "node:test";
import { ToolError } from "../error.ts";
import type { Item, Model } from "../model/index.ts";
import { readProject } from "./index.ts";

const COMPILER_OPTIONS = {
  strict: true,
  target: "es2023",
  module: "nodenext",
  moduleResolution: "nodenext",
  allowImportingTsExtensions: true,
  noEmit: true,
  types: [],
};

const SAMPLE_MANIFEST = JSON.stringify({ name: "sample" });
const SAMPLE_CONFIG = JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["src"] });

const madeDirectories: string[] = [];
after(() => {
  for (const directory of madeDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function directoryWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "deslop-please-ts-"));
  madeDirectories.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function sampleWith(files: Record<string, string>): string {
  return directoryWith({ "package.json": SAMPLE_MANIFEST, "tsconfig.json": SAMPLE_CONFIG, ...files });
}

function readSample(files: Record<string, string>): Model {
  return readProject(sampleWith(files));
}

function nameOf(item: Item | undefined): string | undefined {
  return item?.name;
}

function itemCalled(model: Model, name: string): Item {
  const item = model.items.find((each) => each.name === name);
  assert.ok(item !== undefined, `an item named ${name}`);
  return item;
}

function itemNamed(model: Model, name: string) {
  const item = itemCalled(model, name);
  return {
    kind: item.kind,
    parent: nameOf(item.parent),
    owner: model.tree.display(item.owner),
    takesThis: item.takesThis,
    implementsInheritedMember: item.implementsInheritedMember,
  };
}

function referencesTo(model: Model, name: string) {
  const item = itemCalled(model, name);
  return model.references
    .filter((reference) => reference.item === item)
    .map((reference) => ({
      holder: nameOf(reference.holder),
      line: reference.line,
      onlyReadsValue: reference.onlyReadsValue,
    }));
}

function readsOf(model: Model, name: string): boolean[] {
  return referencesTo(model, name).map((reference) => reference.onlyReadsValue);
}

type WrapperByName =
  | { readonly kind: "forwarder"; readonly target: string; readonly fieldsCalledOn: readonly string[] }
  | { readonly kind: "accessor"; readonly lent: readonly string[]; readonly copied: readonly string[]; readonly lendsOnlyToRead: boolean };

function wrapperOf(model: Model, name: string): WrapperByName | undefined {
  const wrapper = model.wrappers.get(itemCalled(model, name));
  if (wrapper === undefined) {
    return undefined;
  }
  const names = (items: readonly Item[]) => items.map((item) => item.name);
  if (wrapper.kind === "forwarder") {
    return { kind: wrapper.kind, target: wrapper.target.name, fieldsCalledOn: names(wrapper.fieldsCalledOn) };
  }
  return {
    kind: wrapper.kind,
    lent: names(wrapper.lent),
    copied: names(wrapper.copied),
    lendsOnlyToRead: wrapper.lendsOnlyToRead,
  };
}

function modules(model: Model): string[] {
  return model.tree
    .eachAfterItsParent()
    .map((node) => `${model.tree.display(node)}${node.test ? " (test)" : ""}`);
}

function everyDirectoryIn(parent: string): string {
  return posix.join(parent, "*");
}

describe("the workspace", () => {
  test("outside a project is an error", () => {
    const empty = directoryWith({ "notes.txt": "" });
    assert.throws(() => readProject(empty), { name: ToolError.name, message: /^not inside a TypeScript project/ });
  });

  test("a package.json or pnpm-workspace.yaml of an unexpected form is an error that names the file", () => {
    const badManifest = directoryWith({ "package.json": JSON.stringify({ name: 5 }), "tsconfig.json": SAMPLE_CONFIG });
    assert.throws(() => readProject(badManifest), { name: ToolError.name, message: /package\.json has an unexpected form/ });
    const badWorkspace = directoryWith({ "pnpm-workspace.yaml": "packages: libs\n", "package.json": SAMPLE_MANIFEST });
    assert.throws(() => readProject(badWorkspace), {
      name: ToolError.name,
      message: /pnpm-workspace\.yaml has an unexpected form/,
    });
  });

  test("a project without any tsconfig.json is an error", () => {
    const root = directoryWith({ "package.json": SAMPLE_MANIFEST, "src/a.ts": "export const a = 1;\n" });
    assert.throws(() => readProject(root), { name: ToolError.name, message: /tsconfig\.json/ });
  });

  test("a working directory below the root reads the whole project", () => {
    const root = sampleWith({ "src/deep/inner/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" });
    const model = readProject(join(root, "src", "deep"));
    assert.deepEqual(
      model.files.map((file) => file.path),
      ["src/b.ts", "src/deep/inner/a.ts"],
    );
  });

  test("npm workspaces are members of the root package, without the excluded ones, named by package.json", () => {
    const member = (name: string | undefined) => (name === undefined ? "{}" : JSON.stringify({ name }));
    const model = readProject(
      directoryWith({
        "package.json": JSON.stringify({ name: "monorepo", workspaces: [everyDirectoryIn("packages"), "!packages/ignored"] }),
        "packages/core/package.json": member("@acme/core"),
        "packages/core/tsconfig.json": SAMPLE_CONFIG,
        "packages/core/src/a.ts": "export const a = 1;\n",
        "packages/unnamed/package.json": member(undefined),
        "packages/unnamed/tsconfig.json": SAMPLE_CONFIG,
        "packages/unnamed/src/b.ts": "export const b = 2;\n",
        "packages/ignored/package.json": member("ignored"),
        "packages/ignored/tsconfig.json": SAMPLE_CONFIG,
        "packages/ignored/src/c.ts": "export const c = 3;\n",
      }),
    );
    assert.deepEqual(model.files.map((file) => [file.path, model.tree.display(file.module)]), [
      ["packages/core/src/a.ts", "@acme/core/src/a"],
      ["packages/unnamed/src/b.ts", "unnamed/src/b"],
    ]);
    const core = model.files[0]?.module;
    assert.ok(core !== undefined);
    const corePackage = model.tree.packageOf(core);
    assert.ok(corePackage !== undefined);
    assert.equal(corePackage.parent?.name, "monorepo");
  });

  test("pnpm workspace members are packages under the workspace when the root has no package.json", () => {
    const model = readProject(
      directoryWith({
        "pnpm-workspace.yaml": `packages:\n  - '${everyDirectoryIn("apps")}'\n  - libs/shared\n`,
        "apps/web/package.json": JSON.stringify({ name: "web" }),
        "apps/web/tsconfig.json": SAMPLE_CONFIG,
        "apps/web/src/main.ts": "export const main = 1;\n",
        "libs/shared/package.json": JSON.stringify({ name: "shared" }),
        "libs/shared/tsconfig.json": SAMPLE_CONFIG,
        "libs/shared/src/index.ts": "export const shared = 1;\n",
      }),
    );
    const packages = model.tree
      .eachAfterItsParent()
      .filter((node) => node.kind === "package")
      .map((node) => [node.name, node.parent]);
    assert.deepEqual(packages, [
      ["web", model.tree.root],
      ["shared", model.tree.root],
    ]);
  });

  test("a package inside another package is its child, and its files are its own, read once", () => {
    const model = readProject(
      directoryWith({
        "package.json": JSON.stringify({ name: "outer", workspaces: ["tools/inner"] }),
        "tsconfig.json": JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["src", "tools"] }),
        "src/a.ts": "export const a = 1;\n",
        "tools/inner/package.json": JSON.stringify({ name: "inner" }),
        "tools/inner/tsconfig.json": SAMPLE_CONFIG,
        "tools/inner/src/b.ts": "export const b = 2;\n",
      }),
    );
    assert.deepEqual(model.files.map((file) => [file.path, model.tree.display(file.module)]), [
      ["src/a.ts", "outer/src/a"],
      ["tools/inner/src/b.ts", "inner/src/b"],
    ]);
    assert.ok(modules(model).includes("inner"));
    const inner = model.tree.eachAfterItsParent().find((node) => node.name === "inner");
    assert.ok(inner !== undefined);
    assert.equal(inner.parent?.name, "outer");
  });

  test("the projects a tsconfig.json references are read too", () => {
    const model = readSample({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.lib.json" }, { path: "./tools" }] }),
      "tsconfig.lib.json": SAMPLE_CONFIG,
      "tools/tsconfig.json": JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["."] }),
      "src/a.ts": "export const a = 1;\n",
      "tools/build.ts": "export const build = 2;\n",
    });
    assert.deepEqual(
      model.files.map((file) => file.path),
      ["src/a.ts", "tools/build.ts"],
    );
  });

  test("only TypeScript source files of the programs count, not declaration files or hidden directories", () => {
    const model = readSample({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...COMPILER_OPTIONS, jsx: "preserve" },
        files: ["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.cts", "src/e.d.ts", ".scripts/f.ts"],
      }),
      "src/a.ts": "export const a = 1;\n",
      "src/b.tsx": "export const b = 2;\n",
      "src/c.mts": "export const c = 3;\n",
      "src/d.cts": "export const d = 4;\n",
      "src/e.d.ts": "export declare const e: number;\n",
      ".scripts/f.ts": "export const f = 6;\n",
    });
    assert.deepEqual(
      model.files.map((file) => file.path),
      ["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.cts"],
    );
  });
});

describe("files that git ignores", () => {
  const files = {
    ".gitignore": "src/generated/\n",
    "src/generated/schema.ts": "export class Schema { version = 1; }\n",
    "src/use.ts": 'import { Schema } from "./generated/schema.ts";\nexport const schema = new Schema().version;\n',
  };

  test("inside a git work tree, a file that git ignores is outside the model, and so are the names that resolve into it", () => {
    const root = sampleWith(files);
    const init = spawnSync("git", ["init", "--quiet"], { cwd: root });
    assert.equal(init.status, 0);
    const model = readProject(root);
    assert.deepEqual(
      model.files.map((file) => file.path),
      ["src/use.ts"],
    );
    assert.deepEqual(model.items.map((item) => item.name), ["schema"]);
    assert.deepEqual(model.references, []);
  });

  test("outside a git work tree, nothing is left out", () => {
    const model = readSample(files);
    assert.deepEqual(
      model.files.map((file) => file.path),
      ["src/generated/schema.ts", "src/use.ts"],
    );
  });
});

describe("the tree and the files", () => {
  test("directories and files are modules, an index file is its directory's own code, and a file beside a directory of its name is the same module", () => {
    const model = readSample({
      "src/index.ts": "export const root = 1;\n",
      "src/queue.ts": "export const queue = 1;\n",
      "src/queue/ring.ts": "export const ring = 1;\n",
      "src/queue/ring.test.ts": "export const checked = 1;\n",
      "src/view/index.tsx": "export const view = 1;\n",
      "src/view/panel.mts": "export const panel = 1;\n",
    });
    assert.deepEqual(model.files.map((file) => [file.path, model.tree.display(file.module)]), [
      ["src/index.ts", "sample/src"],
      ["src/queue.ts", "sample/src/queue"],
      ["src/queue/ring.test.ts", "sample/src/queue/ring.test"],
      ["src/queue/ring.ts", "sample/src/queue/ring"],
      ["src/view/index.tsx", "sample/src/view"],
      ["src/view/panel.mts", "sample/src/view/panel"],
    ]);
  });

  test("test files and the files in test directories are test code, and so are their modules", () => {
    const model = readSample({
      "src/run.ts": "export const run = 1;\n",
      "src/run.test.ts": "export const a = 1;\n",
      "src/run.spec.tsx": "export const b = 1;\n",
      "src/run.stories.tsx": "export const h = 1;\n",
      "src/__tests__/case.ts": "export const c = 1;\n",
      "src/__mocks__/fake.ts": "export const d = 1;\n",
      "src/test/helper.ts": "export const e = 1;\n",
      "src/tests/index.ts": "export const f = 1;\n",
      "src/testing/tool.ts": "export const g = 1;\n",
    });
    assert.deepEqual(
      model.files.map((file) => [file.path, file.test]),
      [
        ["src/__mocks__/fake.ts", true],
        ["src/__tests__/case.ts", true],
        ["src/run.spec.tsx", true],
        ["src/run.stories.tsx", true],
        ["src/run.test.ts", true],
        ["src/run.ts", false],
        ["src/test/helper.ts", true],
        ["src/testing/tool.ts", false],
        ["src/tests/index.ts", true],
      ],
    );
    assert.deepEqual(
      modules(model).filter((name) => name.endsWith("(test)")),
      [
        "sample/src/__mocks__ (test)",
        "sample/src/__mocks__/fake (test)",
        "sample/src/__tests__ (test)",
        "sample/src/__tests__/case (test)",
        "sample/src/run.spec (test)",
        "sample/src/run.stories (test)",
        "sample/src/run.test (test)",
        "sample/src/test (test)",
        "sample/src/test/helper (test)",
        "sample/src/tests (test)",
      ],
    );
    const caseFile = model.files.find((file) => file.path === "src/__tests__/case.ts");
    assert.ok(caseFile !== undefined && model.tree.isTest(caseFile.module));
  });

  test("a file's lines are counted as Rust's str::lines counts them", () => {
    const model = readSample({
      "src/a.ts": "",
      "src/b.ts": "\n",
      "src/c.ts": "const c = 1;\nconst d = 2;",
      "src/d.ts": "const e = 1;\n\n// two\n",
      "src/e.ts": "const f = 1;\r\nconst g = 2;\r\n",
    });
    assert.deepEqual(
      model.files.map((file) => file.lines),
      [0, 1, 2, 3, 2],
    );
  });
});

describe("the items", () => {
  const model = readSample({
    "src/shapes.ts": [
      "export interface Shape {",
      "  area(): number;",
      "  name: string;",
      "}",
      "export interface Solid extends Shape {",
      "  volume(): number;",
      "}",
      "export class Base {",
      "  tick(): void {}",
      "}",
      "export class Middle extends Base {}",
    ].join("\n"),
    "src/kinds.ts": [
      'import { Middle, type Solid } from "./shapes.ts";',
      "export type Config = { server: { port: number }; reload(): void };",
      "export enum Level { Low, High }",
      "export const limit = 3;",
      "export let counter = 0;",
      "export const double = (value: number) => value * 2;",
      "export const triple = function (value: number) { return value * 3; };",
      "export function local(): number {",
      "  function inner(): number { return 1; }",
      "  const hidden = 2;",
      "  return inner() + hidden;",
      "}",
      "export class Cube extends Middle implements Solid {",
      "  static unit = 1;",
      "  static of(): Cube { return new Cube(1); }",
      "  side: number;",
      "  name = 'cube';",
      "  onResize = () => this.side;",
      "  constructor(side: number, private readonly scale: number = 1) { super(); this.side = side; }",
      "  area(): number { return this.side * this.side * this.scale; }",
      "  volume(): number { return this.area() * this.side; }",
      "  override tick(): void {}",
      "  grow(): void {}",
      "  get size(): number { return this.side; }",
      "  set size(value: number) { this.side = value; }",
      "}",
      "export namespace Geometry {",
      "  export function area(side: number): number { return side * side; }",
      "}",
      "export function pick(value: string): string;",
      "export function pick(value: number): number;",
      "export function pick(value: string | number): string | number { return value; }",
      "export interface Merged { first: number }",
      "export interface Merged { second: number }",
    ].join("\n"),
    "src/anonymous.ts": "export default function () { return 1; }\n",
  });

  test("types, functions, fields, variants and constants are told apart", () => {
    assert.deepEqual(
      [
        "Config",
        "Level",
        "Cube",
        "Shape",
        "double",
        "triple",
        "local",
        "Cube.area",
        "Cube.constructor",
        "Cube.size",
        "Cube.onResize",
        "Shape.area",
        "Config.reload",
        "Cube.side",
        "Cube.scale",
        "Shape.name",
        "Config.server",
        "Config.server.port",
        "Level.High",
        "limit",
        "counter",
        "Cube.unit",
      ].map((name) => [name, itemNamed(model, name).kind]),
      [
        ["Config", "type"],
        ["Level", "type"],
        ["Cube", "type"],
        ["Shape", "type"],
        ["double", "function"],
        ["triple", "function"],
        ["local", "function"],
        ["Cube.area", "function"],
        ["Cube.constructor", "function"],
        ["Cube.size", "function"],
        ["Cube.onResize", "function"],
        ["Shape.area", "function"],
        ["Config.reload", "function"],
        ["Cube.side", "field"],
        ["Cube.scale", "field"],
        ["Shape.name", "field"],
        ["Config.server", "field"],
        ["Config.server.port", "field"],
        ["Level.High", "variant"],
        ["limit", "constant"],
        ["counter", "constant"],
        ["Cube.unit", "constant"],
      ],
    );
  });

  test("members name their parent, a nested field the field around it, and every item its file's module", () => {
    assert.equal(itemNamed(model, "Cube.side").parent, "Cube");
    assert.equal(itemNamed(model, "Config.server").parent, "Config");
    assert.equal(itemNamed(model, "Config.server.port").parent, "Config.server");
    assert.equal(itemNamed(model, "Level.Low").parent, "Level");
    assert.equal(itemNamed(model, "Geometry.area").parent, undefined);
    assert.equal(itemNamed(model, "local").parent, undefined);
    assert.equal(itemNamed(model, "Cube.area").owner, "sample/src/kinds");
    assert.equal(itemNamed(model, "Shape").owner, "sample/src/shapes");
    assert.equal(itemNamed(model, "default").kind, "function");
    assert.equal(itemNamed(model, "default").owner, "sample/src/anonymous");
  });

  test("locals inside a function are no items", () => {
    const names = model.items.map((item) => item.name);
    assert.ok(!names.includes("inner"));
    assert.ok(!names.includes("hidden"));
  });

  test("an overloaded function, a getter with its setter and merged interfaces are one item each", () => {
    const names = model.items.map((item) => item.name);
    assert.equal(names.filter((name) => name === "pick").length, 1);
    assert.equal(names.filter((name) => name === "Cube.size").length, 1);
    assert.equal(names.filter((name) => name === "Merged").length, 1);
    assert.equal(itemNamed(model, "Merged.second").parent, "Merged");
  });

  test("an instance method, an accessor and an instance function property take this; a constructor, a static and a free function do not", () => {
    assert.deepEqual(
      ["Cube.area", "Cube.size", "Cube.onResize", "Shape.area", "Cube.constructor", "Cube.of", "local", "double"].map(
        (name) => [name, itemNamed(model, name).takesThis],
      ),
      [
        ["Cube.area", true],
        ["Cube.size", true],
        ["Cube.onResize", true],
        ["Shape.area", true],
        ["Cube.constructor", false],
        ["Cube.of", false],
        ["local", false],
        ["double", false],
      ],
    );
  });

  test("a class member implements an inherited member when an implemented interface or a base class declares it, at any depth", () => {
    assert.deepEqual(
      ["Cube.area", "Cube.name", "Cube.volume", "Cube.tick", "Cube.grow", "Cube.side", "Cube.constructor"].map(
        (name) => [name, itemNamed(model, name).implementsInheritedMember],
      ),
      [
        ["Cube.area", true],
        ["Cube.name", true],
        ["Cube.volume", true],
        ["Cube.tick", true],
        ["Cube.grow", false],
        ["Cube.side", false],
        ["Cube.constructor", false],
      ],
    );
  });
});

describe("the references", () => {
  test("a reference names its holder, its module, its line and whether it is test code, and imports and declarations are none", () => {
    const model = readSample({
      "src/ring.ts": [
        "export class RunQueue {",
        "  items: number[] = [];",
        "  push(item: number): void {",
        "    this.items.push(item);",
        "  }",
        "}",
      ].join("\n"),
      "src/app.ts": [
        'import { RunQueue } from "./ring.ts";',
        'export { RunQueue } from "./ring.ts";',
        "export const shared = new RunQueue();",
        "shared.push(Math.max(1, 2));",
        "export function run(queue: RunQueue): void {",
        "  queue.push(1);",
        "}",
      ].join("\n"),
      "src/app.test.ts": ['import { run, shared } from "./app.ts";', "run(shared);"].join("\n"),
    });
    const from = (path: string) =>
      model.references
        .filter((reference) => reference.file.path === path)
        .map((reference) => [
          nameOf(reference.holder),
          nameOf(reference.item),
          reference.line,
          model.tree.display(reference.from),
          reference.test,
        ]);
    assert.deepEqual(from("src/app.ts"), [
      ["shared", "RunQueue", 3, "sample/src/app", false],
      [undefined, "shared", 4, "sample/src/app", false],
      [undefined, "RunQueue.push", 4, "sample/src/app", false],
      ["run", "RunQueue", 5, "sample/src/app", false],
      ["run", "RunQueue.push", 6, "sample/src/app", false],
    ]);
    assert.deepEqual(from("src/app.test.ts"), [
      [undefined, "run", 2, "sample/src/app.test", true],
      [undefined, "shared", 2, "sample/src/app.test", true],
    ]);
    assert.deepEqual(from("src/ring.ts"), [["RunQueue.push", "RunQueue.items", 4, "sample/src/ring", false]]);
  });

  test("names reach their item through renamed, default and namespace imports and through re-exports", () => {
    const model = readSample({
      "src/ring.ts": "export class RunQueue {}\nexport default function fresh(): RunQueue { return new RunQueue(); }\n",
      "src/relay.ts": 'export { RunQueue as Queue } from "./ring.ts";\n',
      "src/app.ts": [
        'import fresh from "./ring.ts";',
        'import * as ring from "./ring.ts";',
        'import { Queue } from "./relay.ts";',
        'import { RunQueue as Renamed } from "./ring.ts";',
        "export function run() {",
        "  return [fresh(), new ring.RunQueue(), new Queue(), new Renamed()];",
        "}",
      ].join("\n"),
    });
    assert.deepEqual(
      model.references
        .filter((reference) => nameOf(reference.holder) === "run")
        .map((reference) => nameOf(reference.item)),
      ["fresh", "RunQueue", "RunQueue", "RunQueue"],
    );
  });

  test("creating an instance names the class and, when it has one, its constructor", () => {
    const model = readSample({
      "src/ring.ts": [
        "export class Sized { constructor(readonly limit: number) {} }",
        "export class Plain {}",
      ].join("\n"),
      "src/app.ts": [
        'import * as ring from "./ring.ts";',
        "export function make() {",
        "  return [new ring.Sized(3), new ring.Plain()];",
        "}",
      ].join("\n"),
    });
    assert.deepEqual(
      model.references
        .filter((reference) => nameOf(reference.holder) === "make")
        .map((reference) => nameOf(reference.item)),
      ["Sized", "Sized.constructor", "Plain"],
    );
  });

  test("type positions, JSX tags and JSX attributes are references", () => {
    const model = readSample({
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...COMPILER_OPTIONS, jsx: "preserve" }, include: ["src"] }),
      "src/jsx.d.ts": "declare global { namespace JSX { interface Element {} interface IntrinsicElements {} } }\nexport {};\n",
      "src/panel.tsx": [
        "export interface PanelProps { title: string }",
        "export function Panel(props: PanelProps): JSX.Element { return <div>{props.title}</div>; }",
        "export const shown: PanelProps = { title: 'x' };",
        'export const view = <Panel title="queue" />;',
      ].join("\n"),
    });
    assert.deepEqual(referencesTo(model, "PanelProps").map((reference) => reference.holder), ["Panel", "shown"]);
    assert.deepEqual(referencesTo(model, "Panel").map((reference) => reference.holder), ["view"]);
    assert.deepEqual(
      referencesTo(model, "PanelProps.title").map((reference) => [reference.holder, reference.line]),
      [
        ["Panel", 2],
        ["view", 4],
      ],
    );
  });

  test("a shorthand property refers to its value, and a destructuring to the property it reads", () => {
    const model = readSample({
      "src/queue.ts": [
        "export interface Queue { items: number[]; head: number }",
        "export function handler(): void {}",
        "export const table = { handler };",
        "export function sum(queue: Queue): number {",
        "  const { items, head: at } = queue;",
        "  return items.length + at;",
        "}",
        "export function first({ items }: Queue): number | undefined {",
        "  return items[0];",
        "}",
      ].join("\n"),
    });
    assert.deepEqual(referencesTo(model, "handler"), [{ holder: "table", line: 3, onlyReadsValue: false }]);
    assert.deepEqual(referencesTo(model, "Queue.items"), [
      { holder: "sum", line: 5, onlyReadsValue: true },
      { holder: "first", line: 8, onlyReadsValue: true },
    ]);
    assert.deepEqual(referencesTo(model, "Queue.head"), [{ holder: "sum", line: 5, onlyReadsValue: true }]);
  });
});

describe("what code does with a field", () => {
  const model = readSample({
    "src/state.ts": [
      "function noop(): void {}",
      "export enum Mode { Idle, Busy }",
      "export interface Inner { depth: number }",
      "export class State {",
      "  count = 0;",
      "  label = 'x';",
      "  note?: string;",
      "  mode: Mode = Mode.Idle;",
      "  kind: 'a' | 'b' = 'a';",
      "  items: number[] = [];",
      "  pair: readonly [number, string] = [1, 'a'];",
      "  seen = new Set<string>();",
      "  index = new Map<string, number[]>();",
      "  totals: Record<string, number> = {};",
      "  inner: Inner = { depth: 0 };",
      "  nested = new Map<string, Inner>();",
      "  callback: () => void = noop;",
      "}",
    ].join("\n"),
    "src/use.ts": [
      'import type { Inner, State } from "./state.ts";',
      "declare function take<Value>(value: Value): void;",
      "export function writes(state: State): void {",
      "  state.count = 1;",
      "  state.count += 1;",
      "  state.count++;",
      "  --state.count;",
      "  [state.count] = [2];",
      "  ({ next: state.count } = { next: 3 });",
      "  delete state.note;",
      "}",
      "export function reaches(state: State): void {",
      "  take(state.label.length);",
      "  take(state.items.length);",
      "  take(state.items[0]);",
      "  state.items.push(1);",
      "  take(state.inner.depth);",
      "  take(state.inner?.depth);",
      "}",
      "export function tests(state: State): void {",
      "  if (state.inner) take(1);",
      "  take(state.inner === undefined);",
      "  take(!state.items);",
      "  take(typeof state.inner);",
      "  take(state.inner instanceof Object);",
      "  take(state.inner ? 1 : 2);",
      "  while (state.items) break;",
      "}",
      "export function calls(state: State): void {",
      "  state.callback();",
      "}",
      "export function takes(state: State): Inner {",
      "  take(state.count);",
      "  take(state.mode);",
      "  take(state.kind);",
      "  take(state.items);",
      "  take(state.pair);",
      "  take(state.seen);",
      "  take(state.index);",
      "  take(state.totals);",
      "  take(state.nested);",
      "  take(`${state.label}`);",
      "  return state.inner;",
      "}",
    ].join("\n"),
  });

  test("a write never only reads", () => {
    assert.deepEqual(readsOf(model, "State.count").slice(0, 6), [false, false, false, false, false, false]);
    assert.deepEqual(readsOf(model, "State.note"), [false]);
  });

  test("reaching into a field only reads a primitive one", () => {
    assert.deepEqual(readsOf(model, "State.label").slice(0, 1), [true]);
    assert.deepEqual(readsOf(model, "State.items").slice(0, 3), [false, false, false]);
    assert.deepEqual(readsOf(model, "State.inner").slice(0, 2), [false, false]);
  });

  test("testing or calling a field only reads it", () => {
    assert.deepEqual(readsOf(model, "State.inner").slice(2, 7), [true, true, true, true, true]);
    assert.deepEqual(readsOf(model, "State.items").slice(3, 5), [true, true]);
    assert.deepEqual(readsOf(model, "State.callback"), [true]);
  });

  test("taking the value only reads a primitive or plain field, not a structured one", () => {
    const taken = (name: string) => readsOf(model, name).at(-1);
    assert.deepEqual(
      [
        "State.count",
        "State.mode",
        "State.kind",
        "State.items",
        "State.pair",
        "State.seen",
        "State.index",
        "State.totals",
        "State.label",
        "State.nested",
        "State.inner",
      ].map((name) => [name, taken(name)]),
      [
        ["State.count", true],
        ["State.mode", true],
        ["State.kind", true],
        ["State.items", true],
        ["State.pair", true],
        ["State.seen", true],
        ["State.index", true],
        ["State.totals", true],
        ["State.label", true],
        ["State.nested", false],
        ["State.inner", false],
      ],
    );
  });
});

describe("the wrappers", () => {
  const model = readSample({
    "src/work.ts": [
      "export function add(a: number, b: number): number { return a + b; }",
      "export function addBoth(a: number, b: number): number { return add(a, b); }",
      "export function addSwapped(a: number, b: number): number { return add(b, a); }",
      "export const addArrow = (a: number, b: number) => add(a, b);",
      "export async function addLater(a: number, b: number): Promise<number> { return await add(a, b); }",
      "export function addOne(a: number): number { return add(a, 1); }",
      "export function addTwice(a: number, b: number): number { add(a, b); return add(a, b); }",
      "export function ping(a: number): number { return pong(a); }",
      "export function pong(a: number): number { return ping(a); }",
      "export function viaPing(a: number): number { return ping(a); }",
      "export class Slots {",
      "  push(item: number): void { add(item, 1); }",
      "  static make(): Slots { return new Slots(); }",
      "}",
      "export class Inner {",
      "  slots = new Slots();",
      "}",
      "export class Queue {",
      "  inner = new Inner();",
      "  limit = 3;",
      "  #head = 0;",
      "  #items: number[] = [];",
      "  push(item: number): void { this.inner.slots.push(item); }",
      "  pushLimit(): void { this.inner.slots.push(this.limit); }",
      "  pushTo(slots: Slots, item: number): void { slots.push(item); }",
      "  static fresh(): Slots { return Slots.make(); }",
      "  get items(): number[] { return this.#items; }",
      "  get head(): number { return this.#head; }",
      "  set head(value: number) { this.#head = value; }",
      "  headNow(): number { const head = this.#head; return head; }",
      "  setLimit(limit: number): void { this.limit = limit; }",
      "  parts(): [number[], number] { return [this.#items, this.#head]; }",
      "  size(): number { return this.#items.length; }",
      "  static count(queue: Queue): number { return queue.limit; }",
      "}",
      "export function reader(queue: Queue) {",
      "  return [queue.items.length, queue.items, queue.headNow().toFixed(), queue.head, queue.parts(), addBoth(1, 2)];",
      "}",
    ].join("\n"),
  });

  test("a function whose body only passes its parameters on to a function of the model forwards to it", () => {
    for (const name of ["addBoth", "addSwapped", "addArrow", "addLater"]) {
      assert.deepEqual(wrapperOf(model, name), { kind: "forwarder", target: "add", fieldsCalledOn: [] }, name);
    }
    assert.deepEqual(wrapperOf(model, "Queue.push"), {
      kind: "forwarder",
      target: "Slots.push",
      fieldsCalledOn: ["Queue.inner", "Inner.slots"],
    });
    assert.deepEqual(wrapperOf(model, "Queue.pushTo"), { kind: "forwarder", target: "Slots.push", fieldsCalledOn: [] });
    assert.deepEqual(wrapperOf(model, "Queue.fresh"), { kind: "forwarder", target: "Slots.make", fieldsCalledOn: [] });
  });

  test("passing a field or a literal, leaving a parameter of the target out, or doing more is no forwarding", () => {
    for (const name of ["Queue.pushLimit", "addOne", "addTwice", "Slots.push", "add", "Queue.size"]) {
      assert.equal(wrapperOf(model, name), undefined, name);
    }
  });

  test("forwarders that come back to themselves are no forwarders, and one that forwards into them still is", () => {
    assert.equal(wrapperOf(model, "ping"), undefined);
    assert.equal(wrapperOf(model, "pong"), undefined);
    assert.deepEqual(wrapperOf(model, "viaPing"), { kind: "forwarder", target: "ping", fieldsCalledOn: [] });
  });

  test("a method that only hands out or overwrites fields of this is an accessor", () => {
    assert.deepEqual(wrapperOf(model, "Queue.items"), {
      kind: "accessor",
      lent: ["Queue.#items"],
      copied: [],
      lendsOnlyToRead: true,
    });
    assert.deepEqual(wrapperOf(model, "Queue.head"), {
      kind: "accessor",
      lent: ["Queue.#head"],
      copied: [],
      lendsOnlyToRead: false,
    });
    assert.deepEqual(wrapperOf(model, "Queue.headNow"), {
      kind: "accessor",
      lent: [],
      copied: ["Queue.#head"],
      lendsOnlyToRead: true,
    });
    assert.deepEqual(wrapperOf(model, "Queue.setLimit"), {
      kind: "accessor",
      lent: ["Queue.limit"],
      copied: [],
      lendsOnlyToRead: false,
    });
    assert.deepEqual(wrapperOf(model, "Queue.parts"), {
      kind: "accessor",
      lent: ["Queue.#items"],
      copied: ["Queue.#head"],
      lendsOnlyToRead: true,
    });
    assert.equal(wrapperOf(model, "Queue.count"), undefined);
  });

  test("what code does with what an accessor lends to read decides whether it only reads, and any other wrapper call does not", () => {
    const fromReader = (name: string) =>
      referencesTo(model, name)
        .filter((reference) => reference.holder === "reader")
        .map((reference) => reference.onlyReadsValue);
    assert.deepEqual(fromReader("Queue.items"), [false, true]);
    assert.deepEqual(fromReader("Queue.headNow"), [true]);
    assert.deepEqual(fromReader("Queue.head"), [false]);
    assert.deepEqual(fromReader("Queue.parts"), [true]);
    assert.deepEqual(fromReader("addBoth"), [false]);
  });
});
