import { expect, test } from "bun:test";
import { summary } from "../src/index.ts";

test("summary counts done and open", () => {
  const raw = ['{"id":1,"title":"a","done":true}', '{"id":2,"title":"b","done":false}'];
  expect(summary(raw)).toBe("1 done, 1 open");
});
