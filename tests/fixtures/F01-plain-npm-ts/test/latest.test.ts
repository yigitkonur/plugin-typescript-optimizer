// decoy: path contains "test" inside "latest" but this is a real test file
import { describe, expect, it } from "vitest";
import { main } from "../src/index.ts";

describe("main", () => {
  it("returns a string", () => {
    expect(main()).toContain("Ada");
  });
});
