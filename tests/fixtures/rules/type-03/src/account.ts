import * as v from "valibot";

export const AccountSchema = v.object({
  id: v.string(),
});

export interface Account {
  id: string;
}
