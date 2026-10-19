export interface Item {
  id: number;
  name: string;
}

export function itemUrl(base: string, id: number): string {
  return `${base}/items/${id}`;
}

export async function fetchItem(base: string, id: number): Promise<Item> {
  const res = await fetch(itemUrl(base, id));
  return (await res.json()) as any;
}
