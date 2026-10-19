import type { User } from "./user.js";

export interface Order {
  id: string;
  owner: User;
  total: number;
}
