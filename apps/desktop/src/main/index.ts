import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { modelProfiles, resolveTranscriptionPreset } from '@voxmire/core';
import {
  type TranscriptionProgressEvent,
  createJobInputSchema,
  deleteProjectInputSchema,
  exportTranscriptInputSchema,
  renameProjectInputSchema
} from '@voxmire/contracts';
import { detectWhisperEngines, getMachineProfile, getResourceStatus, resolveFfmpegExecutable, resolveFfprobeExecutable, type ResourcePaths } from '@voxmire/engine';
import { createJsonlRuntimeLogger, createVoxmireRuntime, type VoxmireRuntime } from '@voxmire/runtime';
import { openVoxmireDatabase, type VoxmireDatabase } from '@voxmire/storage';

const isDev = !app.isPackaged;
let db: VoxmireDatabase;
let resources: ResourcePaths;
let runtime: VoxmireRuntime;
const waveformCache = new Map<string, Promise<MediaWaveformResult | null>>();
const mediaInfoCache = new Map<string, Promise<MediaInfoResult>>();

type MediaKind = 'audio' | 'video';

type MediaWaveformResult = {
  durationSeconds: number | null;
  peaks: number[];
};

type MediaInfoResult = {
  contentType: string;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: MediaKind;
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'voxmire-media',
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

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
  ipcMain.handle('system:get-machine-profile', () => getMachineProfile(resources));
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
    waveformCache.delete(input.jobId);
    mediaInfoCache.delete(input.jobId);
    return runtime.deleteProject(input.jobId);
  });
  ipcMain.handle('transcripts:get', (_event, jobId: string) => runtime.getTranscriptSegments(jobId));
  ipcMain.handle('media:get-source-url', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    return job ? `voxmire-media://job/${encodeURIComponent(jobId)}` : null;
  });
  ipcMain.handle('media:get-info', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    if (!job) {
      return null;
    }

    let cached = mediaInfoCache.get(jobId);
    if (!cached) {
      cached = createMediaInfo(job.sourceFile.path);
      mediaInfoCache.set(jobId, cached);
    }

    return cached;
  });
  ipcMain.handle('media:get-waveform', (_event, jobId: string) => {
    const job = runtime.getJob(jobId);
    if (!job) {
      return null;
    }

    let cached = waveformCache.get(jobId);
    if (!cached) {
      cached = createWaveformPeaks(job.sourceFile.path, job.sourceFile.durationSeconds).catch(() => {
        waveformCache.delete(jobId);
        return null;
      });
      waveformCache.set(jobId, cached);
    }

    return cached;
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

function registerMediaProtocol(): void {
  protocol.handle('voxmire-media', (request) => {
    const jobId = mediaJobIdFromUrl(request.url);
    if (!jobId) {
      return new Response('Invalid media URL.', { status: 400 });
    }

    const job = runtime.getJob(jobId);
    if (!job) {
      return new Response('Media job not found.', { status: 404 });
    }

    return streamMediaFile(request, job.sourceFile.path);
  });
}

function streamMediaFile(request: Request, sourcePath: string): Response {
  if (!existsSync(sourcePath)) {
    return new Response('Media source unavailable.', { status: 404 });
  }

  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    return new Response('Media source unavailable.', { status: 404 });
  }

  const fileSize = stats.size;
  const contentType = mediaContentType(sourcePath);
  const range = parseRangeHeader(request.headers.get('range'), fileSize);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${fileSize}`
      }
    });
  }

  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType
  };

  if (!range) {
    return new Response(request.method === 'HEAD' ? null : nodeReadableToWeb(createReadStream(sourcePath)), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': fileSize.toString()
      }
    });
  }

  const contentLength = range.end - range.start + 1;
  return new Response(request.method === 'HEAD' ? null : nodeReadableToWeb(createReadStream(sourcePath, { start: range.start, end: range.end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': contentLength.toString(),
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`
    }
  });
}

function nodeReadableToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}

type ByteRange = { start: number; end: number };

function parseRangeHeader(header: string | null, fileSize: number): ByteRange | 'unsatisfiable' | null {
  if (!header) {
    return null;
  }

  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/.exec(header.trim());
  if (!match?.groups) {
    return 'unsatisfiable';
  }

  const startText = match.groups.start;
  const endText = match.groups.end;
  if (!startText && !endText) {
    return 'unsatisfiable';
  }

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return 'unsatisfiable';
    }

    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return 'unsatisfiable';
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

function mediaContentType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

async function createMediaInfo(sourcePath: string): Promise<MediaInfoResult> {
  const fallback = fallbackMediaInfo(sourcePath);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    return fallback;
  }

  const ffprobePath = resolveFfprobeExecutable(resources);
  if (!existsSync(ffprobePath)) {
    return fallback;
  }

  try {
    const output = await runBufferedProcess(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'json',
      sourcePath
    ]);
    const parsed = JSON.parse(output.toString('utf8')) as { streams?: Array<{ codec_type?: string }> };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const hasVideo = streams.some((stream) => stream.codec_type === 'video');
    const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

    return {
      contentType: mediaContentType(sourcePath),
      hasAudio,
      hasVideo,
      kind: hasVideo ? 'video' : 'audio'
    };
  } catch {
    return fallback;
  }
}

function fallbackMediaInfo(sourcePath: string): MediaInfoResult {
  const contentType = mediaContentType(sourcePath);
  const kind: MediaKind = contentType.startsWith('video/') ? 'video' : 'audio';
  return {
    contentType,
    hasAudio: true,
    hasVideo: kind === 'video',
    kind
  };
}

async function createWaveformPeaks(sourcePath: string, durationSeconds: number | null): Promise<MediaWaveformResult | null> {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    return null;
  }

  const ffmpegPath = resolveFfmpegExecutable(resources);
  if (!existsSync(ffmpegPath)) {
    return null;
  }

  const sampleRate = 500;
  const targetPeaks = 1200;
  const pcm = await runBufferedProcess(ffmpegPath, [
    '-v',
    'error',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    sampleRate.toString(),
    '-f',
    's16le',
    'pipe:1'
  ]);

  return {
    durationSeconds,
    peaks: pcmToPeaks(pcm, targetPeaks)
  };
}

function pcmToPeaks(buffer: Buffer, targetPeaks: number): number[] {
  const sampleCount = Math.floor(buffer.length / 2);
  if (sampleCount === 0) {
    return [];
  }

  const peaks: number[] = [];
  const samplesPerPeak = Math.max(1, Math.ceil(sampleCount / targetPeaks));

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += samplesPerPeak) {
    let peak = 0;
    const end = Math.min(sampleCount, sampleIndex + samplesPerPeak);
    for (let current = sampleIndex; current < end; current += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(current * 2)) / 32768);
    }

    peaks.push(Math.max(0.02, Math.min(1, peak)));
  }

  return peaks;
}

function runBufferedProcess(executablePath: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      reject(new Error(`${executablePath} exited with code ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`));
    });
  });
}

function mediaJobIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'voxmire-media:' || url.hostname !== 'job') {
      return null;
    }

    const jobId = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return jobId.length > 0 ? jobId : null;
  } catch {
    return null;
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

  registerMediaProtocol();
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
