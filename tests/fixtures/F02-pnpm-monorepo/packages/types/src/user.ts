import type { Order } from "./order.js";

export interface User {
  id: string;
  orders: Order[];
}
