// Internal module: Session is only referenced by name inside this file, but it
// leaks into the public .d.ts through the inferred return type of open() in api.ts.
export interface Session {
  id: string;
  createdAt: number;
}

let counter = 0;

export function makeSession(): Session {
  counter += 1;
  return { id: `s${counter}`, createdAt: 0 };
}
