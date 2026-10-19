import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "./index.js";

test("main greets", () => {
  assert.match(main('{"name":"ada"}'), /hello ada/);
});
