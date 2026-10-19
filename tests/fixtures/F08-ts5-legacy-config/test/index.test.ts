import { describe, expect, it } from "vitest";
import { greet } from "../src/index";

describe("greet", () => {
  it("formats a greeting", () => {
    expect(greet("Ada", "Lovelace")).toBe("Hello Lovelace, Ada");
  });
});
