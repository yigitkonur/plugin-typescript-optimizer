import { assertEquals } from "@std/assert";
import { add } from "@lib/math.ts";
import { greet } from "./src/greet.ts";

Deno.test("add", () => {
  assertEquals(add(2, 3), 5);
});

Deno.test("greet", () => {
  assertEquals(greet("x"), "Hello, x!");
});
