import { mkdirSync } from 'node:fs';

export function ensureDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true });
  return directory;
}