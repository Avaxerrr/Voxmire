import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { modelProfiles, resolveTranscriptionPreset } from '@voxmire/core';
import {
  createJobInputSchema,
  deleteProjectInputSchema,
  exportTranscriptInputSchema,
  installRuntimeInputSchema,
  mergeTranscriptSegmentInputSchema,
  renameProjectInputSchema,
  replaceTranscriptSegmentsInputSchema,
  resetTranscriptSegmentsInputSchema,
  splitTranscriptSegmentInputSchema,
  updateTranscriptSegmentInputSchema,
  updateTranscriptSegmentTimingInputSchema
} from '@voxmire/contracts';
import { detectWhisperEngines, getMachineProfile, getResourceStatus, getWhisperRuntimeInstallStatuses, installWhisperRuntime, type ResourcePaths } from '@voxmire/engine';
import type { VoxmireRuntime } from '@voxmire/runtime';
import { defaultExportFileName, exportSaveDialogFilters } from './export-dialogs';
import { type MediaMetadataCache } from './media-metadata';
import { mediaSourceUrl } from './media-protocol';

export type ExportDirectoryController = {
  get: () => string;
  set: (directory: string) => string;
  reset: () => string;
};

export type RegisterIpcHandlersOptions = {
  exportDirectory: ExportDirectoryController;
  mediaMetadata: MediaMetadataCache;
  resources: ResourcePaths;
  runtime: VoxmireRuntime;
};

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  const { exportDirectory, mediaMetadata, resources, runtime } = options;

  ipcMain.handle('app:get-info', () => ({
    name: 'Voxmire',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }));

  ipcMain.handle('system:get-engine-availability', () => detectWhisperEngines(resources));
  ipcMain.handle('system:get-resource-status', () => getResourceStatus(resources));
  ipcMain.handle('system:get-machine-profile', () => getMachineProfile(resources));
  ipcMain.handle('system:get-runtime-install-statuses', () => getWhisperRuntimeInstallStatuses(resources));
  ipcMain.handle('system:install-runtime', (_event, rawInput: unknown) => {
    const input = installRuntimeInputSchema.parse(rawInput);
    return installWhisperRuntime(resources, input.runtimeId);
  });
  ipcMain.handle('models:list', () => modelProfiles);
  ipcMain.handle('jobs:list', () => runtime.listJobs());
  ipcMain.handle('jobs:get', (_event, jobId: string) => runtime.getJob(jobId));
  ipcMain.handle('projects:get-details', (_event, jobId: string) => runtime.getProjectDetails(jobId));
  ipcMain.handle('projects:rename', (_event, rawInput: unknown) => {
    const input = renameProjectInputSchema.parse(rawInput);
    return runtime.renameProject(input.jobId, input.name);
  });
  ipcMain.handle('projects:delete', (_event, rawInput: unknown) => {
    const input = deleteProjectInputSchema.parse(rawInput);
    mediaMetadata.clear(input.jobId);
    return runtime.deleteProject(input.jobId);
  });
  ipcMain.handle('transcripts:get', (_event, jobId: string) => runtime.getTranscriptSegments(jobId));
  ipcMain.handle('transcripts:update-segment', (_event, rawInput: unknown) => {
    const input = updateTranscriptSegmentInputSchema.parse(rawInput);
    return runtime.updateTranscriptSegment(input.jobId, input.segmentId, input.text);
  });
  ipcMain.handle('transcripts:update-timing', (_event, rawInput: unknown) => {
    const input = updateTranscriptSegmentTimingInputSchema.parse(rawInput);
    return runtime.updateTranscriptSegmentTiming(input.jobId, input.segmentId, input.startSeconds, input.endSeconds);
  });
  ipcMain.handle('transcripts:split-segment', (_event, rawInput: unknown) => {
    const input = splitTranscriptSegmentInputSchema.parse(rawInput);
    return runtime.splitTranscriptSegment(input.jobId, input.segmentId, input.offset);
  });
  ipcMain.handle('transcripts:merge-segment', (_event, rawInput: unknown) => {
    const input = mergeTranscriptSegmentInputSchema.parse(rawInput);
    return runtime.mergeTranscriptSegment(input.jobId, input.segmentId, input.direction);
  });
  ipcMain.handle('transcripts:replace-segments', (_event, rawInput: unknown) => {
    const input = replaceTranscriptSegmentsInputSchema.parse(rawInput);
    return runtime.replaceTranscriptSegments(input.jobId, input.segments);
  });
  ipcMain.handle('transcripts:reset-segments', (_event, rawInput: unknown) => {
    const input = resetTranscriptSegmentsInputSchema.parse(rawInput);
    return runtime.resetTranscriptSegments(input.jobId);
  });
  ipcMain.handle('media:get-source-url', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    return job ? mediaSourceUrl(jobId) : null;
  });
  ipcMain.handle('media:get-info', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    if (!job) {
      return null;
    }

    return mediaMetadata.getInfo(jobId, job.sourceFile.path);
  });
  ipcMain.handle('media:get-waveform', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    if (!job) {
      return null;
    }

    return mediaMetadata.getWaveform(jobId, job.sourceFile.path, job.sourceFile.durationSeconds);
  });

  ipcMain.handle('jobs:create', async (_event, rawInput: unknown) => {
    const input = createJobInputSchema.parse(rawInput ?? {});
    const selectedPath = await chooseSourceFile();

    if (!selectedPath) {
      return null;
    }

    const selection = input.presetId
      ? resolveTranscriptionPreset(input.presetId, {
          machineProfile: await getMachineProfile(resources),
          fallbackBackend: 'cpu'
        })
      : input;

    return runtime.createTranscriptionJob({
      sourcePath: selectedPath,
      modelId: selection.modelId,
      engineBackend: selection.engineBackend
    });
  });

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => runtime.cancelJob(jobId));
  ipcMain.handle('jobs:pause', (_event, jobId: string) => runtime.pauseJob(jobId));
  ipcMain.handle('jobs:resume', (_event, jobId: string) => runtime.resumeJob(jobId));

  ipcMain.handle('exports:create', async (_event, rawInput: unknown) => {
    const input = exportTranscriptInputSchema.parse(rawInput);
    const job = runtime.getJob(input.jobId);
    if (!job) {
      throw new Error(`Job not found: ${input.jobId}`);
    }

    const defaultPath = join(exportDirectory.get(), defaultExportFileName(job.sourceFile.name, input.jobId, input.format, input.textMode));
    const result = await dialog.showSaveDialog({
      title: 'Export transcript',
      defaultPath,
      filters: exportSaveDialogFilters(input.format)
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    exportDirectory.set(dirname(result.filePath));
    return runtime.exportTranscript(input.jobId, input.format, {
      outputPath: result.filePath,
      textMode: input.textMode
    });
  });

  ipcMain.handle('exports:get-directory', () => exportDirectory.get());

  ipcMain.handle('exports:choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose default export folder',
      defaultPath: exportDirectory.get(),
      properties: ['openDirectory', 'createDirectory']
    });

    const [selectedDirectory] = result.filePaths;
    if (result.canceled || !selectedDirectory) {
      return null;
    }

    return exportDirectory.set(selectedDirectory);
  });

  ipcMain.handle('exports:reset-directory', () => exportDirectory.reset());

  registerWindowIpcHandlers();
}

function registerWindowIpcHandlers(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

async function chooseSourceFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import audio or video',
    properties: ['openFile'],
    filters: [
      { name: 'Audio and video', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'mp4', 'mov', 'webm'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}
