import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../graph/index.ts";
import type { Item } from "../model/index.ts";
import { Sample } from "../model/sample.ts";
import { HELD_IN_MIND } from "./diagnostic.ts";
import type { Diagnostic } from "./diagnostic.ts";
import { tangles } from "./tangles.ts";

function check(sample: Sample): Diagnostic[] {
  return tangles(sample.model, buildGraph(sample.model), undefined);
}

function keys(sample: Sample): string[] {
  return check(sample).map((diagnostic) => diagnostic.key);
}

test("two things in a circle are reported when their code is in two modules", () => {
  const sample = new Sample();
  const kernel = sample.module("kernel");
  const timers = sample.module("kernel/timers");
  const tasks = sample.item(kernel, "Tasks", "type");
  const timer = sample.item(timers, "Timers", "type");
  const spawn = sample.member(tasks, kernel, "Tasks.spawn", "function");
  const fire = sample.member(timer, timers, "Timers.fire", "function");
  sample.refer(spawn, timer);
  sample.refer(fire, tasks);
  assert.deepEqual(keys(sample), ["p/kernel/timers:Timers,p/kernel:Tasks"]);
});

test("a circle in one module is reported only when it is too big to hold in mind", () => {
  const sample = new Sample();
  const module = sample.module("ring");
  const ring = (size: number): void => {
    const things: Item[] = [];
    for (let i = 0; i < size; i += 1) {
      things.push(sample.item(module, `T${size}x${i}`, "type"));
    }
    things.forEach((thing, i) => {
      const next = things[(i + 1) % size];
      assert.ok(next !== undefined);
      sample.refer(thing, next);
    });
  };
  ring(HELD_IN_MIND);
  assert.deepEqual(keys(sample), []);
  ring(HELD_IN_MIND + 1);
  assert.equal(keys(sample).length, 1);
});

test("the picture is the shortest circle through the cheapest tie", () => {
  const sample = new Sample();
  const aModule = sample.module("a");
  const bModule = sample.module("b");
  const a = sample.item(aModule, "A", "type");
  const aX = sample.member(a, aModule, "A.x", "function");
  const b = sample.item(bModule, "B", "type");
  const bRun = sample.member(b, bModule, "B.run", "function");
  const c = sample.item(bModule, "C", "type");
  sample.refer(a, b);
  sample.refer(bRun, c);
  sample.refer(c, a);
  sample.refer(bRun, a);
  sample.refer(bRun, aX);
  const picture = check(sample)[0]?.picture;
  assert.ok(picture?.kind === "circle");
  assert.deepEqual(
    picture.steps.map((step) => [step.member, step.uses]),
    [
      ["p/a:A", "A uses B"],
      ["p/b:B", "B.run uses A, A.x"],
    ],
  );
  assert.equal(picture.rest, "not drawn: 1 more thing, 2 more ties");
});

test("a member body written elsewhere ties its type from there", () => {
  const sample = new Sample();
  const scheduling = sample.module("scheduling");
  const elsewhere = sample.module("elsewhere");
  const tasks = sample.item(scheduling, "Tasks", "type");
  const timers = sample.item(scheduling, "Timers", "type");
  const spawn = sample.member(tasks, scheduling, "Tasks.spawn", "function");
  const fire = sample.member(timers, elsewhere, "Timers.fire", "function");
  sample.refer(spawn, timers);
  sample.refer(fire, tasks);
  const diagnostics = check(sample);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.message, "2 things know each other in a circle, across 2 modules");
  assert.equal(diagnostics[0]?.notes[1], "written in: p/elsewhere, p/scheduling");
});

test("a tie written in two modules is shown in both", () => {
  const sample = new Sample();
  const tail = sample.module("tail");
  const writer = sample.module("writer");
  const walTail = sample.item(tail, "WalTail", "type");
  const scanned = sample.item(tail, "Scanned", "type");
  const scanBytes = sample.member(walTail, tail, "WalTail.scanBytes", "function");
  const scanFile = sample.member(walTail, writer, "WalTail.scanFile", "function");
  const records = sample.member(scanned, tail, "Scanned.records", "field");
  sample.refer(scanBytes, scanned);
  sample.refer(scanFile, records);
  sample.refer(scanned, walTail);
  const notes = check(sample)[0]?.notes ?? [];
  assert.equal(notes[1], "written in: p/tail, p/writer");
  assert.ok(notes[3]?.endsWith("; also at src/writer.ts:2:1"), notes[3]);
});
