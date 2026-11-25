import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../graph/index.ts";
import type { Item, Wrapper } from "../model/index.ts";
import { Sample } from "../model/sample.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { fieldLeaks } from "./leaks.ts";

interface Queue {
  readonly sample: Sample;
  readonly admit: Item;
  readonly head: Item;
  readonly limit: Item;
  readonly runQueue: Item;
}

function queue(): Queue {
  const sample = new Sample();
  const queueModule = sample.module("queue");
  const sched = sample.module("sched");
  const runQueue = sample.item(queueModule, "RunQueue", "type");
  const [items, head, limit] = ["items", "head", "limit"].map((field) =>
    sample.member(runQueue, queueModule, `RunQueue.${field}`, "field"),
  );
  assert.ok(items !== undefined && head !== undefined && limit !== undefined);
  const full = sample.member(runQueue, queueModule, "RunQueue.full", "function");
  full.takesThis = true;
  for (const field of [items, head, limit]) {
    sample.refer(full, field);
  }
  const admit = sample.item(sched, "admit", "function");
  sample.refer(admit, items);
  return { sample, admit, head, limit, runQueue };
}

function check(sample: Sample): Diagnostic[] {
  return fieldLeaks(sample.model, buildGraph(sample.model), undefined);
}

function keys(sample: Sample): string[] {
  return check(sample)
    .map((diagnostic) => diagnostic.key)
    .sort();
}

function getterOfHead({ sample, head, runQueue }: Queue): Item {
  const getter = sample.member(runQueue, head.owner, "RunQueue.head", "function");
  sample.refer(getter, head);
  return getter;
}

test("a field an outsider uses leaks from a struct that guards its others", () => {
  const { sample } = queue();
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.items"]);
  assert.deepEqual(check(sample)[0]?.picture, {
    kind: "spread",
    owner: "p/queue:RunQueue",
    field: "items",
    modules: [{ places: 1, module: "p/sched" }],
    others: ["kept: head, limit"],
  });
});

test("a getter is seen through and free code in the same file is an outsider", () => {
  const fixture = queue();
  const { sample, admit, head } = fixture;
  const getter = getterOfHead(fixture);
  const handsOut = (onlyCopies: boolean): Wrapper => ({
    kind: "accessor",
    lent: onlyCopies ? [] : [head],
    copied: onlyCopies ? [head] : [],
    lendsOnlyToRead: true,
  });
  sample.wrappers.set(getter, handsOut(false));
  const drained = sample.item(head.owner, "drained", "function");
  sample.refer(drained, getter);
  sample.refer(admit, getter);
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.head", "p/queue:RunQueue.items"]);
  sample.wrappers.set(getter, handsOut(true));
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.items"]);
});

test("a borrow a getter lends is no leak where its caller only reads it", () => {
  const fixture = queue();
  const { sample, admit, head } = fixture;
  const getter = getterOfHead(fixture);
  sample.wrappers.set(getter, { kind: "accessor", lent: [head], copied: [], lendsOnlyToRead: true });
  sample.read(admit, getter);
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.items"]);
  sample.refer(admit, getter);
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.head", "p/queue:RunQueue.items"]);
});

test("taking a copy of a field is no leak but the field is not kept", () => {
  const { sample, admit, head, limit } = queue();
  sample.read(admit, head);
  assert.deepEqual(keys(sample), ["p/queue:RunQueue.items"]);
  sample.read(admit, limit);
  assert.deepEqual(keys(sample), []);
});

test("a struct that keeps nothing or does nothing guards nothing", () => {
  const keepsNothing = queue();
  keepsNothing.sample.refer(keepsNothing.admit, keepsNothing.head);
  keepsNothing.sample.refer(keepsNothing.admit, keepsNothing.limit);
  assert.deepEqual(keys(keepsNothing.sample), []);
  const { sample } = queue();
  for (const item of sample.items) {
    item.takesThis = false;
  }
  assert.deepEqual(keys(sample), []);
});
