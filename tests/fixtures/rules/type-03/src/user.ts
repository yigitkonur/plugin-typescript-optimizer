import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});

export interface User {
  id: string;
  email: string;
  displayName: string;
}
