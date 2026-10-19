export interface UnusedCreateUserDto {
  email: string;
  displayName?: string;
}

export function normalizeCase(value: string): string {
  return value.toLowerCase();
}

export function formatEmail(email: string): string {
  return normalizeCase(email);
}
