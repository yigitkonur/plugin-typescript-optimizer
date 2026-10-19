import type { Order } from "@f02/types";
import { orderTotal } from "./index.js";

export function describeOrder(order: Order): string {
  return `order ${order.id}`;
}

export function summarize(order: Order): string {
  return `${order.id}=${orderTotal(order)}`;
}
