import { priceLine } from "@f02/core";
import type { Order } from "@f02/types";
import { buttonLabel } from "@f02/ui";

export function renderWeb(order: Order): string {
  return `${buttonLabel("pay")} ${priceLine(order)}`;
}
