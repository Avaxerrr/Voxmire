import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { modelProfiles } from '@voxmire/core';
import {
  type ExportFormat,
  type JobStatus,
  type ModelId,
  type SourceFile,
  type TranscriptionProgressEvent,
  createJobInputSchema,
  exportTranscriptInputSchema
} from '@voxmire/contracts';
import {
  WhisperCppCpuEngine,
  defaultModelPath,
  detectWhisperEngines,
  probeMediaFile,
  sourceExtension,
  type ResourcePaths
} from '@voxmire/engine';
import { exportFileExtension, renderTranscriptExport } from '@voxmire/exporters';
import {
  createId,
  createJobRecord,
  getJobWithSource,
  getTranscriptSegments,
  listJobs,
  openVoxmireDatabase,
  saveTranscriptSegment,
  updateJobProgress,
  updateJobStatus,
  type VoxmireDatabase
} from '@voxmire/storage';

const isDev = !app.isPackaged;
let db: VoxmireDatabase;
let resources: ResourcePaths;
const activeJobs = new Map<string, AbortController>();

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Voxmire',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111318' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-info', () => ({
    name: 'Voxmire',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }));

  ipcMain.handle('system:get-engine-availability', () => detectWhisperEngines(resources));
  ipcMain.handle('models:list', () => modelProfiles);
  ipcMain.handle('jobs:list', () => listJobs(db));
  ipcMain.handle('jobs:get', (_event, jobId: string) => getJobWithSource(db, jobId));
  ipcMain.handle('transcripts:get', (_event, jobId: string) => getTranscriptSegments(db, jobId));

  ipcMain.handle('jobs:create', async (_event, rawInput: unknown) => {
    const input = createJobInputSchema.parse(rawInput ?? {});
    const selectedPath = await chooseSourceFile();

    if (!selectedPath) {
      return null;
    }

    const sourceFile = await createSourceFile(selectedPath);
    const created = createJobRecord(db, {
      sourceFile,
      modelId: input.modelId,
      engineBackend: 'cpu'
    });

    void runJob(created.job.id, input.modelId);
    return created;
  });

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => {
    const active = activeJobs.get(jobId);
    active?.abort();
    activeJobs.delete(jobId);
    const job = updateJobStatus(db, jobId, 'canceled', { progress: 0 });
    broadcastProgress({
      jobId,
      status: 'canceled',
      progress: job?.progress ?? 0,
      message: 'Job canceled.',
      segment: null
    });
    return job;
  });

  ipcMain.handle('exports:create', async (_event, rawInput: unknown) => {
    const input = exportTranscriptInputSchema.parse(rawInput);
    const jobWithSource = getJobWithSource(db, input.jobId);

    if (!jobWithSource) {
      throw new Error(`Job not found: ${input.jobId}`);
    }

    const segments = getTranscriptSegments(db, input.jobId);
    const rendered = renderTranscriptExport(input.format, segments);
    const exportDirectory = ensureAppDirectory('exports');
    const outputPath = join(
      exportDirectory,
      `${sanitizeFileName(jobWithSource.sourceFile.name)}-${input.jobId}.${exportFileExtension(input.format)}`
    );

    writeFileSync(outputPath, rendered, 'utf8');
    return { path: outputPath, format: input.format };
  });
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

async function createSourceFile(filePath: string): Promise<SourceFile> {
  const stats = statSync(filePath);
  let durationSeconds: number | null = null;

  try {
    const probe = await probeMediaFile(resources, filePath);
    durationSeconds = probe.durationSeconds;
  } catch {
    durationSeconds = null;
  }

  return {
    id: createId('src'),
    path: filePath,
    name: basename(filePath),
    extension: sourceExtension(filePath),
    sizeBytes: stats.size,
    durationSeconds,
    createdAt: new Date().toISOString()
  };
}

async function runJob(jobId: string, modelId: ModelId): Promise<void> {
  const abortController = new AbortController();
  activeJobs.set(jobId, abortController);

  try {
    const jobWithSource = getJobWithSource(db, jobId);
    if (!jobWithSource) {
      throw new Error(`Job not found: ${jobId}`);
    }

    updateAndBroadcast(jobId, 'preparing', 0.05, 'Preparing local transcription job.');

    const modelPath = defaultModelPath(resources, modelId);
    const outputDirectory = ensureAppDirectory('engine-output');

    if (!existsSync(modelPath)) {
      throw new Error(`Missing model file: ${modelPath}`);
    }

    updateAndBroadcast(jobId, 'transcribing', 0.1, 'Starting whisper.cpp CPU engine.');

    const engine = new WhisperCppCpuEngine(resources);
    for await (const event of engine.transcribe({
      jobId,
      sourcePath: jobWithSource.sourceFile.path,
      modelPath,
      outputDirectory,
      signal: abortController.signal
    })) {
      if (abortController.signal.aborted) {
        return;
      }

      if (event.segment) {
        saveTranscriptSegment(db, event.segment);
      }

      updateJobProgress(db, jobId, event.progress);
      broadcastProgress(event);
    }

    updateAndBroadcast(jobId, 'completed', 1, 'Transcription completed.');
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown transcription failure.';
    updateJobStatus(db, jobId, 'failed', { errorMessage: message });
    broadcastProgress({ jobId, status: 'failed', progress: 0, message, segment: null });
  } finally {
    activeJobs.delete(jobId);
  }
}

function updateAndBroadcast(jobId: string, status: JobStatus, progress: number, message: string): void {
  updateJobStatus(db, jobId, status, { progress });
  broadcastProgress({ jobId, status, progress, message, segment: null });
}

function broadcastProgress(event: TranscriptionProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('jobs:progress', event);
  }
}

function ensureAppDirectory(name: string): string {
  const directory = join(app.getPath('userData'), name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function getProjectRoot(): string {
  if (isDev) {
    return resolve(app.getAppPath(), '../..');
  }

  return process.resourcesPath;
}

function sanitizeFileName(value: string): string {
  const withoutExtension = value.replace(extname(value), '');
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
}

void app.whenReady().then(() => {
  resources = { projectRoot: getProjectRoot() };
  db = openVoxmireDatabase(join(app.getPath('userData'), 'voxmire.sqlite'));
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
