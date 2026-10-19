import { completed, countOpen, parseTodo } from "./todos.ts";

export function summary(raw: string[]): string {
  const todos = raw.map(parseTodo);
  return `${completed(todos).length} done, ${countOpen(todos)} open`;
}

if (import.meta.main) {
  console.log(summary(['{"id":1,"title":"a","done":true}']));
}
