import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpuThreadPreferenceSchema, type CpuThreadPreference, type TranscriptionSettings } from '@voxmire/contracts';

export type DesktopSettings = {
  exportDirectory?: string;
  cpuThreadPreference?: CpuThreadPreference;
};

export function defaultExportDirectory(): string {
  return join(app.getPath('documents'), 'Voxmire Exports');
}

export function resolveExportDirectory(settings: DesktopSettings): string {
  return settings.exportDirectory ?? defaultExportDirectory();
}

export function resolveTranscriptionSettings(settings: DesktopSettings): TranscriptionSettings {
  return {
    cpuThreadPreference: settings.cpuThreadPreference ?? 'auto'
  };
}

export function loadDesktopSettings(): DesktopSettings {
  try {
    const parsed = JSON.parse(readFileSync(desktopSettingsPath(), 'utf8')) as Partial<DesktopSettings>;
    const settings: DesktopSettings = {};
    if (typeof parsed.exportDirectory === 'string' && parsed.exportDirectory.trim().length > 0) {
      settings.exportDirectory = parsed.exportDirectory;
    }

    const cpuThreadPreference = cpuThreadPreferenceSchema.safeParse(parsed.cpuThreadPreference);
    if (cpuThreadPreference.success) {
      settings.cpuThreadPreference = cpuThreadPreference.data;
    }

    return settings;
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
