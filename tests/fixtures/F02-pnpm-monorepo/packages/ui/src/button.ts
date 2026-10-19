import { capitalize } from "@f02/utils";

export function buttonLabel(text: string): string {
  return `[${capitalize(text)}]`;
}
