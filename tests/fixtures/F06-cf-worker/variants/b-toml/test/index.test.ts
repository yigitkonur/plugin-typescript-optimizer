import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker", () => {
  it("responds ok", async () => {
    const response = await SELF.fetch("https://example.com/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("counts through the durable object", async () => {
    const first = await SELF.fetch("https://example.com/count");
    expect(await first.text()).toBe("1");
    const second = await SELF.fetch("https://example.com/count");
    expect(await second.text()).toBe("2");
  });
});
