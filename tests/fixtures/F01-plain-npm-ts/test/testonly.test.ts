import { describe, expect, it } from "vitest";
import { buildFixtureUser, describeUser } from "../src/testonly.ts";

describe("testonly", () => {
  it("builds a user", () => {
    expect(describeUser(buildFixtureUser(7))).toBe("7:user-7");
  });
});
