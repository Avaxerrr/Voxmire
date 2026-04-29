import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function ensureAppDirectory(name: string): string {
  const directory = join(app.getPath('userData'), name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function getProjectRoot(isDev: boolean): string {
  if (isDev) {
    return resolve(app.getAppPath(), '../..');
  }

  return process.resourcesPath;
}
