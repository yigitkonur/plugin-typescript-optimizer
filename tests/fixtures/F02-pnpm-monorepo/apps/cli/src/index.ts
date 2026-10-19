import { tag } from "@f02/core";
import { slugify } from "@f02/utils";

export function run(arg: string): string {
  return tag(slugify(arg));
}
