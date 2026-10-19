import { readFileSync } from "node:fs";

export function readRethrow(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw error;
  }
}

export function readSwallow(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.log(error);
    return null;
  }
}

// decoy: enriches the error with context and cause
export function readWithContext(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${path}`, { cause: error });
  }
}

// decoy: logs with context at an intentional boundary
export function readOrDefault(path: string, fallback: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`readOrDefault failed for ${path}`, error);
    return fallback;
  }
}
