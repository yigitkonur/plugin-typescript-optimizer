export async function loadWidget(name: string): Promise<{ render(): string }> {
  const mod = await import(`./${name}`);
  return mod.default;
}
