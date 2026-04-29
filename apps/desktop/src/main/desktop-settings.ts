import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DesktopSettings = {
  exportDirectory?: string;
};

export function defaultExportDirectory(): string {
  return join(app.getPath('documents'), 'Voxmire Exports');
}

export function resolveExportDirectory(settings: DesktopSettings): string {
  return settings.exportDirectory ?? defaultExportDirectory();
}

export function loadDesktopSettings(): DesktopSettings {
  try {
    const parsed = JSON.parse(readFileSync(desktopSettingsPath(), 'utf8')) as Partial<DesktopSettings>;
    return typeof parsed.exportDirectory === 'string' && parsed.exportDirectory.trim().length > 0
      ? { exportDirectory: parsed.exportDirectory }
      : {};
  } catch {
    return {};
  }
}

export function saveDesktopSettings(settings: DesktopSettings): void {
  try {
    writeFileSync(desktopSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Desktop settings are best-effort UI preferences.
  }
}

function desktopSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}
