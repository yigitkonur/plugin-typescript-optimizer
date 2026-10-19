export interface Parsed {
  key: string;
  value: number;
}

export function parseLine(line: string): Parsed {
  try {
    const [key, raw] = line.split("=");
    return { key: key ?? "", value: Number(raw) };
  } catch (e) {
    throw e;
  }
}
