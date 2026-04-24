import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { modelProfiles } from '@voxmire/core';
import { type TranscriptionProgressEvent, createJobInputSchema, exportTranscriptInputSchema } from '@voxmire/contracts';
import { detectWhisperEngines, getResourceStatus, type ResourcePaths } from '@voxmire/engine';
import { createJsonlRuntimeLogger, createVoxmireRuntime, type VoxmireRuntime } from '@voxmire/runtime';
import { openVoxmireDatabase, type VoxmireDatabase } from '@voxmire/storage';

const isDev = !app.isPackaged;
let db: VoxmireDatabase;
let resources: ResourcePaths;
let runtime: VoxmireRuntime;

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Voxmire',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111318' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
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
  ipcMain.handle('system:get-resource-status', () => getResourceStatus(resources));
  ipcMain.handle('models:list', () => modelProfiles);
  ipcMain.handle('jobs:list', () => runtime.listJobs());
  ipcMain.handle('jobs:get', (_event, jobId: string) => runtime.getJob(jobId));
  ipcMain.handle('transcripts:get', (_event, jobId: string) => runtime.getTranscriptSegments(jobId));

  ipcMain.handle('jobs:create', async (_event, rawInput: unknown) => {
    const input = createJobInputSchema.parse(rawInput ?? {});
    const selectedPath = await chooseSourceFile();

    if (!selectedPath) {
      return null;
    }

    return runtime.createTranscriptionJob({
      sourcePath: selectedPath,
      modelId: input.modelId,
      engineBackend: 'cpu'
    });
  });

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => runtime.cancelJob(jobId));
  ipcMain.handle('jobs:pause', (_event, jobId: string) => runtime.pauseJob(jobId));
  ipcMain.handle('jobs:resume', (_event, jobId: string) => runtime.resumeJob(jobId));

  ipcMain.handle('exports:create', (_event, rawInput: unknown) => {
    const input = exportTranscriptInputSchema.parse(rawInput);
    return runtime.exportTranscript(input.jobId, input.format);
  });

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

void app.whenReady().then(() => {
  resources = { projectRoot: getProjectRoot() };
  db = openVoxmireDatabase(join(app.getPath('userData'), 'voxmire.sqlite'));
  runtime = createVoxmireRuntime({
    db,
    resources,
    directories: {
      engineOutputDirectory: ensureAppDirectory('engine-output'),
      exportDirectory: ensureAppDirectory('exports')
    },
    logger: createJsonlRuntimeLogger(join(ensureAppDirectory('logs'), 'voxmire.jsonl')),
    onProgress: broadcastProgress
  });

  registerIpcHandlers();
  createMainWindow();
  void runtime.recoverInterruptedJobs();

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
