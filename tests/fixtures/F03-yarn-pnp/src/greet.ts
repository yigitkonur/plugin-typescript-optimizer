import kleur from "kleur";

export function greet(name: string): string {
  return kleur.bold(`hello ${name}`);
}

export function unusedExport(): number {
  return 42;
}
