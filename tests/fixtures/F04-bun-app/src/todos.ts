import { TodoSchema, type Todo } from "./schema.ts";

export function parseTodo(raw: string): Todo {
  return TodoSchema.parse(JSON.parse(raw));
}

export function completed(todos: Todo[]): Todo[] {
  return todos.filter((todo) => todo.done === true);
}

export function countOpen(todos: Todo[]): number {
  return todos.length - completed(todos).length;
}

export function loadTodos(path: string): Promise<Todo[]> {
  return Bun.file(path)
    .json()
    .then((data) => (data as unknown as Todo[]))
    .catch((error) => {
      console.error(`could not load todos from ${path}`, error);
      return [];
    });
}
