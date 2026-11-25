import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../graph/index.ts";
import { idFromIndex } from "../id.ts";
import type { ItemId } from "../model/index.ts";
import { Sample } from "../model/sample.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { shallowModules } from "./shallow.ts";

function store(shown: number, hidden: number): Sample {
  const sample = new Sample();
  const storeModule = sample.module("store");
  const app = sample.module("app");
  sample.module("store/table");
  const type = sample.item(storeModule, "Store", "type");
  const run = sample.item(app, "run", "function");
  const helpers: ItemId[] = [];
  for (let i = 0; i < hidden; i += 1) {
    helpers.push(sample.member(type, storeModule, `Store.helper${i}`, "function"));
  }
  for (let i = 0; i < shown; i += 1) {
    const method = sample.member(type, storeModule, `Store.m${i}`, "function");
    sample.refer(run, method);
    for (const helper of helpers) {
      sample.refer(method, helper);
    }
  }
  return sample;
}

function things(widths: readonly number[], free: number): Sample {
  const sample = new Sample();
  const storeModule = sample.module("store");
  const app = sample.module("app");
  sample.module("store/table");
  const run = sample.item(app, "run", "function");
  widths.forEach((width, t) => {
    const type = sample.item(storeModule, `T${t}`, "type");
    for (let i = 0; i < width; i += 1) {
      sample.refer(run, sample.member(type, storeModule, `T${t}.m${i}`, "function"));
    }
  });
  for (let i = 0; i < free; i += 1) {
    sample.refer(run, sample.item(storeModule, `f${i}`, "function"));
  }
  return sample;
}

function knowing(sample: Sample, name: string, types: readonly string[]): void {
  const function_ = sample.item(sample.module("store"), name, "function");
  sample.refer(sample.named("run"), function_);
  for (const type of types) {
    sample.refer(function_, sample.named(type));
  }
}

function check(sample: Sample): Diagnostic[] {
  return shallowModules(sample.model, buildGraph(sample.model), undefined);
}

function keys(sample: Sample): string[] {
  return check(sample).map((diagnostic) => diagnostic.key);
}

function notes(sample: Sample): readonly string[] {
  const diagnostics = check(sample);
  const [only] = diagnostics;
  assert.ok(only !== undefined && diagnostics.length === 1);
  return only.notes;
}

test("a module that shows more than it hides and more than seven is shallow", () => {
  assert.deepEqual(keys(store(8, 8)), ["p/store"]);
  assert.deepEqual(check(store(8, 8))[0]?.picture, {
    kind: "lists",
    shown: 8,
    hidden: 8,
    lists: [{ name: "Store", length: 8 }],
  });
  assert.deepEqual(keys(store(8, 9)), []);
  assert.deepEqual(keys(store(7, 0)), []);
});

test("seven is a limit on each list not on their sum", () => {
  assert.deepEqual(keys(things([5, 5, 5], 0)), []);
  assert.deepEqual(keys(things([5, 4, 3], 1)), []);
  assert.deepEqual(keys(things([7, 7, 7, 7, 7, 7, 7], 0)), []);
  assert.deepEqual(keys(things([], 7)), []);
  assert.deepEqual(keys(things([], 8)), ["p/store"]);
  assert.deepEqual(keys(things([8], 0)), ["p/store"]);
});

test("the notes name each list that is too long the things first then the widest", () => {
  assert.deepEqual(notes(things([2, 8], 5)), [
    "`T1` shows 8 functions: T1.m0, T1.m1, T1.m2, T1.m3, T1.m4, T1.m5, T1.m6, +1 more",
  ]);
  assert.deepEqual(notes(things([8, 9, 9], 5)), [
    "shows 8 things: T1, T2, T0, f0, f1, f2, f3, +1 more",
    "`T1` shows 9 functions: T1.m0, T1.m1, T1.m2, T1.m3, T1.m4, T1.m5, T1.m6, +2 more",
    "`T2` shows 9 functions: T2.m0, T2.m1, T2.m2, T2.m3, T2.m4, T2.m5, T2.m6, +2 more",
    "`T0` shows 8 functions: T0.m0, T0.m1, T0.m2, T0.m3, T0.m4, T0.m5, T0.m6, +1 more",
  ]);
  assert.deepEqual(notes(things([1], 7)), ["shows 8 things: T0, f0, f1, f2, f3, f4, f5, +1 more"]);
});

test("a free function is on the list of each type of the module it knows", () => {
  const oneType = things([6], 0);
  knowing(oneType, "fa", ["T0"]);
  knowing(oneType, "fb", ["T0"]);
  assert.deepEqual(keys(oneType), ["p/store"]);
  assert.deepEqual(keys(things([6], 2)), []);

  const twoTypes = things([6, 6], 0);
  knowing(twoTypes, "both", ["T0", "T1"]);
  knowing(twoTypes, "first", ["T0"]);
  knowing(twoTypes, "second", ["T1"]);
  assert.deepEqual(notes(twoTypes), [
    "`T0` shows 8 functions: T0.m0, T0.m1, T0.m2, T0.m3, T0.m4, T0.m5, both, +1 more",
    "`T1` shows 8 functions: T1.m0, T1.m1, T1.m2, T1.m3, T1.m4, T1.m5, both, +1 more",
  ]);
});

test("a free function that knows no type of the module is a thing of its own", () => {
  const sample = things([], 7);
  sample.item(sample.module("app"), "Outside", "type");
  knowing(sample, "e", ["Outside"]);
  assert.deepEqual(notes(sample), ["shows 8 things: e, f0, f1, f2, f3, f4, f5, +1 more"]);
});

test("lists that share a free function never make a module shallow that shows seven", () => {
  const sample = things([0, 0, 0, 0, 0, 0, 0, 0], 0);
  knowing(sample, "build", ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
  assert.deepEqual(keys(sample), []);
});

test("wrappers count for nothing and a method counts at its type's home", () => {
  const sample = store(8, 8);
  const type = idFromIndex<ItemId>(0);
  const storeModule = sample.module("store");
  const app = sample.module("app");
  for (let i = 0; i < 8; i += 1) {
    const forwarder = sample.member(type, storeModule, `Store.pad${i}`, "function");
    sample.wrappers.set(forwarder, { kind: "forwarder", target: idFromIndex<ItemId>(3), fieldsCalledOn: [] });
  }
  const moved = sample.member(type, app, "Store.moved", "function");
  sample.refer(sample.named("run"), moved);
  assert.equal(check(sample)[0]?.message, "`p/store` is shallow: it shows 9 of its 17 functions");
});
