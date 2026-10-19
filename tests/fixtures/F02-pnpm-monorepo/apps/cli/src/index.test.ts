import { expect, it } from "vitest";
import { run } from "./index.js";

it("runs", () => {
  expect(run("Hello World")).toMatch(/^hello-world#\d$/);
});
