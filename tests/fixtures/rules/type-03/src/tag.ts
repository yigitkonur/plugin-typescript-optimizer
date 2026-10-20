import { z } from "zod";

export const TagSchema = z.object({ label: z.string() });
