import type { Item } from "./api.js";

export function formatItem(item: Item): string {
  return `#${item.id} ${item.name}`;
}

export function unusedFormatter(item: Item): string {
  return item.name.toUpperCase();
}
