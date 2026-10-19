const test = require("node:test");
const assert = require("node:assert/strict");
const Registry = require("../src/registry");
const { Color, pickColor } = require("../src/color");

test("registry add/get", () => {
  const r = new Registry("t");
  r.add("x", 2);
  assert.equal(r.get("x"), 2);
  assert.equal(r.get("y"), null);
});

test("color helpers", () => {
  assert.equal(Color.GREEN, "green");
  assert.equal(pickColor({}), null);
  assert.equal(pickColor({ color: "red" }), "red");
});
