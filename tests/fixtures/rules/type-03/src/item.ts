import { type } from "arktype";

export const ItemSchema = type({ sku: "string" });

type Item = {
  sku: string;
};

export const itemSku = (i: Item): string => i.sku;
