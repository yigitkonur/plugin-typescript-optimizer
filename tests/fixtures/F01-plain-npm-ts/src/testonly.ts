interface User {
  id: number;
  name: string;
}

export function buildFixtureUser(id: number): User {
  return { id, name: `user-${id}` };
}

export function describeUser(user: User): string {
  return `${user.id}:${user.name}`;
}
