import test from "node:test";
import assert from "node:assert/strict";
import { open, clamp, double, describe } from "../dist/index.js";

test("open returns a session", () => {
  assert.match(open().id, /^s\d+$/);
});

test("clamp and double", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(double(4), 8);
  assert.equal(describe("a", 1).label, "session 1");
});
