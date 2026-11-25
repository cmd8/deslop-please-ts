import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOL } from "../src/tool.ts";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
const PROGRAM = fileURLToPath(new URL("../src/main.ts", import.meta.url));

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const madeDirectories: string[] = [];
after(() => {
  for (const directory of madeDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function newDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), `${TOOL}-end-to-end-`));
  madeDirectories.push(directory);
  return directory;
}

function workspace(fixture: string, variant?: string): string {
  const copy = join(newDirectory(), fixture);
  cpSync(join(TESTS, "fixtures", fixture), copy, { recursive: true });
  if (variant !== undefined) {
    cpSync(join(TESTS, "variants", fixture, variant), copy, { recursive: true });
  }
  return copy;
}

function run(directory: string, words: readonly string[] = []): Run {
  const result = spawnSync(process.execPath, [PROGRAM, ...words], { cwd: directory, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function keys(directory: string): string[] {
  const allow = `${directory}.keys`;
  assert.equal(run(directory, ["--update-allow", allow]).code, 0);
  return readFileSync(allow, "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .sort();
}

function variantKeys(family: string, variant?: string): string[] {
  return keys(workspace(family, variant));
}

test("a clean workspace exits zero", () => {
  const result = run(workspace("clean"));
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes(`${TOOL}: ok`));
});

test("a leaked field leaks however it is reached, and not once the type does the work", () => {
  const runQueue = run(workspace("field_leak"));
  assert.equal(runQueue.code, 1);
  assert.ok(
    runQueue.stdout.includes("error[field-leak]: `RunQueue.items` is known outside `RunQueue`: 4 places in 2 modules"),
  );
  assert.ok(
    runQueue.stdout.includes(
      [
        "    runqueue/src/queue/ring:RunQueue",
        "      items ◀━┳━ 2  runqueue/src/sched/policy",
        "              ┗━ 2  runqueue/src/sched/report",
        "      also known outside: head",
        "      kept: limit",
        "",
      ].join("\n"),
    ),
  );
  const leaked = [
    "field-leak runqueue/src/queue/ring:RunQueue.head",
    "field-leak runqueue/src/queue/ring:RunQueue.items",
  ];
  const leakedPrivate = [
    "field-leak runqueue/src/queue/ring:RunQueue.#head",
    "field-leak runqueue/src/queue/ring:RunQueue.#items",
  ];
  for (const variant of ["all_pub", "pasted"]) {
    assert.deepEqual(variantKeys("field_leak", variant), leaked, variant);
  }
  for (const variant of ["getters", "let_getters", "tuple_getter"]) {
    assert.deepEqual(variantKeys("field_leak", variant), leakedPrivate, variant);
  }
  for (const variant of ["real", "passed_on", "read", "lent_read"]) {
    assert.deepEqual(variantKeys("field_leak", variant), [], variant);
  }
});

test("a module cycle stays one through a re-export or a relay, until code moves where it is used", () => {
  const net = run(workspace("module_cycle"));
  assert.equal(net.code, 1);
  assert.ok(net.stdout.includes("error[module-cycle]: 2 modules in `net/src` use each other in a circle"));
  assert.ok(!net.stdout.includes("error[tangle]"));
  assert.ok(
    net.stdout.includes(
      [
        "    ┌─▶ kinds",
        "    │     ┃ kinds.ts:9   Stream.open uses BACKLOG_MOST",
        "    │     ▼",
        "    │   socket",
        "    │     │ socket.ts:5  listen uses Stream, Stream.open",
        "    └─────┘",
        "",
      ].join("\n"),
    ),
  );
  assert.deepEqual(variantKeys("module_cycle", "reexported"), ["module-cycle net/src/kinds,net/src/socket"]);
  assert.deepEqual(variantKeys("module_cycle", "relayed"), ["module-cycle net/src/kinds,net/src/limits,net/src/socket"]);
  assert.deepEqual(variantKeys("module_cycle", "moved"), []);
});

test("code only for tests makes no module cycle, and the same code outside test files does", () => {
  const forTests = workspace("module_cycle", "for_tests");
  assert.deepEqual(keys(forTests), []);
  const cycle = ["module-cycle net/src/kinds,net/src/socket"];

  const probe = workspace("module_cycle", "for_tests");
  renameSync(join(probe, "src/kinds/probe.spec.ts"), join(probe, "src/kinds/probe.ts"));
  assert.deepEqual(keys(probe), cycle);

  const fixtures = workspace("module_cycle", "for_tests");
  const harness = join(fixtures, "src/kinds/harness.test.ts");
  renameSync(join(fixtures, "src/kinds/__mocks__/fixtures.ts"), join(fixtures, "src/kinds/fixtures.ts"));
  writeFileSync(
    join(fixtures, "src/kinds/fixtures.ts"),
    readFileSync(join(fixtures, "src/kinds/fixtures.ts"), "utf8").replaceAll("../../", "../"),
  );
  writeFileSync(harness, readFileSync(harness, "utf8").replace("./__mocks__/fixtures.ts", "./fixtures.ts"));
  assert.deepEqual(keys(fixtures), cycle);
});

test("a tangle stays one however it is laid out, until it is one module or untied", () => {
  const tasksAndTimers = "tangle boot/src/kernel/tasks:Tasks,boot/src/kernel/timers:Timers";
  const cycle = "module-cycle boot/src/kernel/tasks,boot/src/kernel/timers";
  const boot = run(workspace("tangle"));
  assert.ok(boot.stdout.includes("error[tangle]: 2 things know each other in a circle, across 2 modules"));
  assert.ok(
    boot.stdout.includes(
      [
        "    ┌─▶ boot/src/kernel/tasks:Tasks",
        "    │     ┃ tasks.ts:11   Tasks.spawn uses Timers, Timers.arm",
        "    │     ▼",
        "    │   boot/src/kernel/timers:Timers",
        "    │     │ timers.ts:10  Timers.fire uses Tasks, Tasks.wake",
        "    └─────┘",
        "",
      ].join("\n"),
    ),
  );
  assert.ok(boot.stdout.includes("error[module-cycle]: 2 modules in `boot/src/kernel` use each other in a circle"));
  assert.deepEqual(variantKeys("tangle", "impl_moved"), [tasksAndTimers]);
  assert.deepEqual(variantKeys("tangle", "lifted"), ["tangle boot/src/kernel/timers:Timers,boot/src/kernel:Tasks"]);
  for (const variant of ["merged", "real", "lifted_untied"]) {
    assert.deepEqual(variantKeys("tangle", variant), [], variant);
  }

  const ring = workspace("tangle", "ring");
  const result = run(ring);
  assert.ok(result.stdout.includes("error[tangle]: 8 things know each other in a circle, all in `boot/src/ring`"));
  const ringKey =
    "tangle boot/src/ring:A,boot/src/ring:B,boot/src/ring:C,boot/src/ring:D," +
    "boot/src/ring:E,boot/src/ring:F,boot/src/ring:G,boot/src/ring:H";
  assert.deepEqual(keys(ring), [cycle, tasksAndTimers, ringKey]);
});

test("a shallow module stays shallow however it is dressed, until it does more with less", () => {
  const store = run(workspace("shallow"));
  assert.ok(store.stdout.includes("error[shallow-module]: `inventory/src/store` is shallow: it shows 9 of its 15 functions"));
  assert.ok(
    store.stdout.includes(
      "= note: `Store` shows 9 functions: Store.constructor, Store.contains, Store.get, Store.insert, " +
        "Store.isFull, Store.largest, Store.remove, +2 more",
    ),
  );
  assert.ok(
    store.stdout.includes(
      ["                  7", "    shows  ███████│██ 9", "    hides  ██████ │ 6", "    Store  ███████│██ 9", ""].join("\n"),
    ),
  );
  const shallow = ["shallow-module inventory/src/store"];
  for (const variant of ["padded", "impls_moved", "pub_field", "private_modules", "some_free_functions", "free_functions"]) {
    assert.deepEqual(variantKeys("shallow", variant), shallow, variant);
  }
  const free = run(workspace("shallow", "free_functions"));
  assert.ok(
    free.stdout.includes(
      "= note: `Store` shows 9 functions: Store.constructor, contains, get, insert, isFull, largest, remove, +2 more",
    ),
  );
  assert.deepEqual(variantKeys("shallow", "deep"), []);
});

test("small types that each show a few functions are not shallow, however many they show in all", () => {
  const stats = run(workspace("small_types"));
  assert.ok(stats.stdout.includes(`${TOOL}: ok`));
  assert.equal(stats.code, 0);
});

test("a long file and a wide directory are reported until they are split", () => {
  const clean = workspace("clean");
  const kinds = join(clean, "src/kinds.ts");
  const original = readFileSync(kinds, "utf8");
  const originalLines = original.split("\n").length - 1;
  const padded = original + "\n".repeat(2000 - originalLines);
  writeFileSync(kinds, padded);
  const parts = (count: number) => {
    for (let part = 1; part <= count; part += 1) {
      writeFileSync(join(clean, `src/socket/part${part}.ts`), `export class Part${part} {}\n`);
    }
  };
  parts(13);
  assert.deepEqual(keys(clean), []);

  parts(14);
  writeFileSync(kinds, `${padded}export class Late {}\n`);
  const result = run(clean);
  assert.equal(result.code, 1);
  assert.ok(
    result.stdout.includes(
      [
        "error[wide-directory]: `src/socket/` is wide: it holds 16 files and directories, more than 15",
        "  --> src/socket/index.ts:1:1",
        "  = note: 16 files: datagram.ts, index.ts, part1.ts, part10.ts, part11.ts, part12.ts, part13.ts, +9 more",
        "                         15",
        "    holds  ███████████████│█ 16",
        "",
      ].join("\n"),
    ),
  );
  assert.ok(
    result.stdout.includes(
      ["error[long-file]: `src/kinds.ts` is long: it has 2001 lines, more than 2000", "  --> src/kinds.ts:1:1", ""].join(
        "\n",
      ),
    ),
  );
  assert.deepEqual(keys(clean), ["long-file src/kinds.ts", "wide-directory src/socket/"]);
});

test("the allow file suppresses only existing entries and notes what is fixed", () => {
  const runQueue = workspace("field_leak");
  const allow = `${runQueue}.allow`;
  assert.equal(run(runQueue, ["--update-allow", allow]).code, 0);
  const allowed = run(runQueue, ["--allow", allow]);
  assert.equal(allowed.code, 0);
  assert.ok(allowed.stdout.includes(`${TOOL}: ok`));

  cpSync(join(TESTS, "variants/field_leak/real"), runQueue, { recursive: true });
  const fixed = run(runQueue, ["--allow", allow]);
  assert.equal(fixed.code, 0);
  assert.ok(fixed.stdout.includes("2 allowed entries"));
  assert.ok(fixed.stdout.includes("now fixed"));

  const ring = ["A", "B", "C", "D", "E", "F", "G", "H"]
    .map((name, index, names) => `export interface ${name} {\n  next: ${names[(index + 1) % names.length]} | undefined;\n}\n`)
    .join("\n");
  writeFileSync(join(runQueue, "src/ring.ts"), ring);
  const added = run(runQueue, ["--allow", allow]);
  assert.equal(added.code, 1);
  assert.ok(added.stdout.includes("error[tangle]: 8 things"));
  assert.ok(!added.stdout.includes("field-leak"));
});

test("across packages a field leaks, and test code is left out", () => {
  const packages = workspace("two_crates");
  assert.equal(run(packages).code, 0);

  appendFileSync(
    join(packages, "crates/lib/src/index.ts"),
    [
      "",
      "export class Plain {",
      "  x = 0;",
      "  y = 0;",
      "}",
      "",
      "export class Vault {",
      "  #secret = 1;",
      "  leaked = 2;",
      "",
      "  next(): number {",
      "    return this.#secret + 1;",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(packages, "crates/lib/src/index.test.ts"),
    'import { Vault } from "./index.ts";\n\nexport function peeks(): number {\n  return new Vault().leaked;\n}\n',
  );
  appendFileSync(
    join(packages, "app/tests/it.ts"),
    '\nimport { Vault } from "lib";\n\nexport function peeks(): number {\n  return new Vault().leaked;\n}\n',
  );
  const main = join(packages, "app/src/main.ts");
  const original = readFileSync(main, "utf8");
  const header = 'import type { Plain, Vault } from "lib";\n';
  writeFileSync(main, `${header}${original}\nexport function bumpPlain(p: Plain): void {\n  p.x += 1;\n}\n`);
  assert.deepEqual(keys(packages), []);
  writeFileSync(main, `${header}${original}\nexport function readVault(v: Vault): number {\n  return v.leaked;\n}\n`);
  assert.deepEqual(keys(packages), []);

  writeFileSync(main, `${header}${original}\nexport function bumpVault(v: Vault): void {\n  v.leaked += 1;\n}\n`);
  const result = run(packages);
  assert.equal(result.code, 1);
  assert.ok(result.stdout.includes("error[field-leak]: `Vault.leaked` is known outside `Vault`: 1 place in 1 module"));
  assert.deepEqual(keys(packages), ["field-leak lib/src:Vault.leaked"]);
});

test("test files in a directory named after a module do not make it shallow, and layout checks still see them", () => {
  const clean = workspace("clean");
  const calls = Array.from({ length: 8 }, (_, index) => `queue.f${index + 1}()`).join(" + ");
  writeFileSync(
    join(clean, "src/index.ts"),
    `import * as queue from "./queue.ts";\n\nexport function run(): number {\n  return ${calls};\n}\n`,
  );
  writeFileSync(
    join(clean, "src/queue.ts"),
    Array.from({ length: 8 }, (_, index) => `export function f${index + 1}(): number {\n  return ${index + 1};\n}\n`).join(
      "\n",
    ),
  );
  assert.deepEqual(keys(clean), []);

  mkdirSync(join(clean, "src/queue/__tests__"), { recursive: true });
  const part = 'import { run } from "../../index.ts";\n\nexport function runs(): boolean {\n  return run() === 36;\n}\n';
  writeFileSync(join(clean, "src/queue/__tests__/part.ts"), part);
  writeFileSync(join(clean, "src/queue/helper.test.ts"), "export function expected(): number {\n  return 36;\n}\n");
  assert.deepEqual(keys(clean), []);

  writeFileSync(join(clean, "src/queue/__tests__/part.ts"), part + "\n".repeat(2000));
  assert.deepEqual(keys(clean), ["long-file src/queue/__tests__/part.ts"]);
});

test("outside a TypeScript project it reports an error", () => {
  const empty = newDirectory();
  const result = run(empty);
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes("not inside a TypeScript project"));
});
