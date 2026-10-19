import type { Order } from "@f02/types";
import { formatMoney } from "@f02/utils";
import { describeOrder } from "./index.js";

export function orderTotal(order: Order): string {
  return formatMoney(order.total);
}

export function priceLine(order: Order): string {
  return `${describeOrder(order)} ${orderTotal(order)}`;
}
