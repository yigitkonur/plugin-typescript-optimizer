import { expect, it } from "vitest";
import { capitalize, slugify } from "./strings.js";

it("formats strings", () => {
  expect(capitalize("abc")).toBe("Abc");
  expect(slugify("A B")).toBe("a-b");
});
