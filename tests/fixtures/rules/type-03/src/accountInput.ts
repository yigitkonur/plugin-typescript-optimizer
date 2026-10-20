import type { AccountSchema } from "./account";

export type AccountInput = v.InferOutput<typeof AccountSchema>;
