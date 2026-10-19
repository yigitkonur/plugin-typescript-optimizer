import { expect, it } from "vitest";
import { priceLine, summarize } from "./index.js";

const order = { id: "o1", total: 1250, owner: { id: "u1", orders: [] } };

it("prices an order", () => {
  expect(priceLine(order)).toBe("order o1 $12.50");
  expect(summarize(order)).toBe("o1=$12.50");
});
