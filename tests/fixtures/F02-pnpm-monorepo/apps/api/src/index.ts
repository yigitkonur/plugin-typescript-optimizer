import { summarize } from "@f02/core";
import type { User } from "@f02/types";

export function handle(user: User): string[] {
  return user.orders.map((order) => summarize(order));
}
