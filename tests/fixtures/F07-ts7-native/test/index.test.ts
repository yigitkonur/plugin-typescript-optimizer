import { describe, expect, it } from "vitest";
import { countRows, titleToPath } from "../src/index.js";

describe("index", () => {
  it("builds a path from a title", () => {
    expect(titleToPath("Hello, World!")).toBe("/posts/hello-world");
  });

  it("counts csv rows", () => {
    expect(countRows("a,b\nc,d\n")).toBe(2);
  });
});
