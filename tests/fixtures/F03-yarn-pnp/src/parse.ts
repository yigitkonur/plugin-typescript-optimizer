export function parseName(raw: string): string {
  const data = JSON.parse(raw) as any;
  return String(data.name);
}
