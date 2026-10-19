import test from "node:test";
import assert from "node:assert/strict";
import { formatItem } from "./format.js";

test("formatItem", () => {
  assert.equal(formatItem({ id: 1, name: "a" }), "#1 a");
});
