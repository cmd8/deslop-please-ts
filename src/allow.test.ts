import { test } from "node:test";
import assert from "node:assert/strict";
import { AllowList } from "./allow.ts";
import type { Diagnostic } from "./lint/index.ts";

function tangle(key: string): Diagnostic {
  return {
    lint: "tangle",
    key,
    message: "",
    location: undefined,
    notes: [],
    picture: { kind: "circle", steps: [], rest: undefined },
  };
}

function moduleCycle(key: string): Diagnostic {
  return { ...tangle(key), lint: "module-cycle" };
}

function parsed(text: string): AllowList {
  const result = AllowList.parse(text);
  assert.ok(result.kind === "parsed");
  return result.allowList;
}

test("shrinking an allowed tangle stays allowed", () => {
  const allow = parsed("tangle a:X,a:Y,b:Z\n");
  assert.ok(allow.isAllowed(tangle("a:X,b:Z")));
  assert.ok(!allow.isAllowed(tangle("a:W,a:X,a:Y,b:Z")));
  assert.equal(allow.fixedCount([tangle("a:X,a:Y")]), 0);
  assert.equal(allow.fixedCount([]), 1);
});

test("shrinking an allowed module cycle stays allowed", () => {
  const allow = parsed("module-cycle a/x,a/y,a/z\n");
  assert.ok(allow.isAllowed(moduleCycle("a/x,a/z")));
  assert.ok(!allow.isAllowed(moduleCycle("a/w,a/x")));
  assert.ok(!allow.isAllowed(tangle("a/x,a/z")));
});

test("a comma inside a member's name splits nothing", () => {
  const allow = parsed("tangle a:Map<A, B>.get,a:X,a:Y\n");
  assert.ok(allow.isAllowed(tangle("a:Map<A, B>.get,a:Y")));
  assert.ok(!allow.isAllowed(tangle("a:Map<A, C>.get,a:Y")));
  assert.ok(!allow.isAllowed(tangle("a:Y,a:Z")));
});

test("a removed lint is an invalid entry", () => {
  assert.deepEqual(AllowList.parse("field-leak a:T.x\nchatty-seam a -> b\n"), { kind: "invalid", line: 2 });
});
