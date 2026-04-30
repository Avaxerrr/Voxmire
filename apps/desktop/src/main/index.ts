import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { TranscriptionProgressEvent } from '@voxmire/contracts';
import { cleanupStaleWhisperModelDownloads, cleanupStaleWhisperRuntimeDownloads } from '@voxmire/engine';
import { createJsonlRuntimeLogger, createVoxmireRuntime } from '@voxmire/runtime';
import { openVoxmireDatabase } from '@voxmire/storage';
import {
  type DesktopSettings,
  loadDesktopSettings,
  resolveExportDirectory,
  saveDesktopSettings
} from './desktop-settings';
import { registerIpcHandlers, type ExportDirectoryController } from './ipc-handlers';
import { createMainWindow } from './main-window';
import { MediaMetadataCache } from './media-metadata';
import { registerMediaProtocol, registerMediaSchemes } from './media-protocol';
import { ensureAppDirectory, getProjectRoot } from './paths';

const isDev = !app.isPackaged;

registerMediaSchemes();

void app.whenReady().then(() => {
  const resources = { projectRoot: getProjectRoot(isDev), userResourceRoot: ensureAppDirectory('resources') };
  cleanupStaleWhisperRuntimeDownloads(resources);
  cleanupStaleWhisperModelDownloads(resources);
  let desktopSettings = loadDesktopSettings();
  const exportDirectory = createExportDirectoryController(() => desktopSettings, (settings) => {
    desktopSettings = settings;
    saveDesktopSettings(desktopSettings);
  });
  const db = openVoxmireDatabase(join(app.getPath('userData'), 'voxmire.sqlite'));
  const runtime = createVoxmireRuntime({
    db,
    resources,
    directories: {
      engineOutputDirectory: ensureAppDirectory('engine-output'),
      exportDirectory: exportDirectory.get()
    },
    logger: createJsonlRuntimeLogger(join(ensureAppDirectory('logs'), 'voxmire.jsonl')),
    onProgress: broadcastProgress
  });
  const mediaMetadata = new MediaMetadataCache(resources);

  registerMediaProtocol((jobId) => runtime.getJob(jobId)?.sourceFile.path ?? null);
  registerIpcHandlers({
    exportDirectory,
    mediaMetadata,
    resources,
    runtime
  });
  createMainWindow({ isDev, rendererUrl: process.env.ELECTRON_RENDERER_URL });
  void runtime.recoverInterruptedJobs();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ isDev, rendererUrl: process.env.ELECTRON_RENDERER_URL });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createExportDirectoryController(
  getSettings: () => DesktopSettings,
  updateSettings: (settings: DesktopSettings) => void
): ExportDirectoryController {
  return {
    get: () => resolveExportDirectory(getSettings()),
    set: (directory) => {
      updateSettings({ ...getSettings(), exportDirectory: directory });
      return resolveExportDirectory(getSettings());
    },
    reset: () => {
      const nextSettings = { ...getSettings() };
      delete nextSettings.exportDirectory;
      updateSettings(nextSettings);
      return resolveExportDirectory(getSettings());
    }
  };
}

function broadcastProgress(event: TranscriptionProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('jobs:progress', event);
  }
}
