import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  EngineAvailability,
  EngineBackend,
  ModelId,
  ResourceStatus,
  TranscriptSegment,
  TranscriptionProgressEvent
} from '@voxmire/contracts';

export type ResourcePaths = {
  projectRoot: string;
};

export type ProbeResult = {
  durationSeconds: number | null;
  formatName: string | null;
};

export type PreparedAudioChunk = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  filePath: string;
};

export type PrepareAudioOptions = {
  sourcePath: string;
  jobId: string;
  outputDirectory: string;
  durationSeconds: number | null;
  targetChunkSeconds: number;
  overlapSeconds: number;
  maxSecondsBeforeChunking: number;
  signal?: AbortSignal;
};

export type TranscriptionInput = {
  jobId: string;
  sourcePath: string;
  modelPath: string;
  outputDirectory: string;
  outputBaseName?: string;
  signal?: AbortSignal;
};

export interface TranscriptionEngine {
  id: string;
  backend: EngineBackend;
  detect(): Promise<EngineAvailability>;
  transcribe(input: TranscriptionInput): AsyncIterable<TranscriptionProgressEvent>;
}

export function resolveWhisperExecutable(paths: ResourcePaths, backend: EngineBackend): string {
  const executableName = process.platform === 'win32' ? `whisper-${backend}.exe` : `whisper-${backend}`;
  return join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), executableName);
}

export function resolveFfprobeExecutable(paths: ResourcePaths): string {
  const executableName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName);
}

export function resolveFfmpegExecutable(paths: ResourcePaths): string {
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return join(paths.projectRoot, 'resources', 'ffmpeg', executableName);
}

export function detectWhisperEngine(paths: ResourcePaths, backend: EngineBackend): EngineAvailability {
  const executablePath = resolveWhisperExecutable(paths, backend);
  const available = existsSync(executablePath);

  return {
    id: `whisper.cpp-${backend}`,
    kind: 'whisper.cpp',
    backend,
    label: backend === 'cpu' ? 'whisper.cpp CPU' : `whisper.cpp ${backend.toUpperCase()}`,
    available,
    executablePath: available ? executablePath : null,
    reason: available ? null : `Missing ${basename(executablePath)} in ${executablePath}`
  };
}

export function detectWhisperEngines(paths: ResourcePaths): EngineAvailability[] {
  return ['cpu', 'cuda', 'vulkan'].map((backend) => detectWhisperEngine(paths, backend as EngineBackend));
}
export function getResourceStatus(paths: ResourcePaths): ResourceStatus[] {
  const ffmpegPath = resolveFfmpegExecutable(paths);
  const ffprobePath = resolveFfprobeExecutable(paths);
  const engineBackends: EngineBackend[] = ['cpu', 'cuda', 'vulkan'];
  const modelIds: ModelId[] = ['large-v3-turbo', 'large-v3', 'distil-large-v3.5', 'medium'];

  return [
    resourceStatus('ffmpeg', 'ffmpeg', 'FFmpeg', true, ffmpegPath, 'https://www.gyan.dev/ffmpeg/builds/'),
    resourceStatus('ffprobe', 'ffprobe', 'ffprobe', true, ffprobePath, 'https://www.gyan.dev/ffmpeg/builds/'),
    ...engineBackends.map((backend) => {
      const path = resolveWhisperExecutable(paths, backend);
      return resourceStatus(
        `whisper-${backend}`,
        'whisper-engine',
        `whisper.cpp ${backend.toUpperCase()}`,
        backend === 'cpu',
        path,
        'https://github.com/ggml-org/whisper.cpp/releases'
      );
    }),
    ...['whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'].map((fileName) =>
      resourceStatus(
        `whisper-runtime-${fileName}`,
        'whisper-engine',
        fileName,
        true,
        join(paths.projectRoot, 'resources', 'engines', platformResourceDirectory(), fileName),
        'https://github.com/ggml-org/whisper.cpp/releases'
      )
    ),
    ...modelIds.map((modelId) => {
      const path = defaultModelPath(paths, modelId);
      return resourceStatus(
        `model-${modelId}`,
        'model',
        `GGML ${modelId}`,
        modelId === 'large-v3-turbo',
        path,
        'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
      );
    })
  ];
}

function resourceStatus(
  id: string,
  kind: ResourceStatus['kind'],
  label: string,
  required: boolean,
  path: string,
  sourceUrl: string
): ResourceStatus {
  const available = existsSync(path);
  return {
    id,
    kind,
    label,
    required,
    available,
    path,
    sourceUrl,
    reason: available ? null : `Missing ${basename(path)} at ${path}`
  };
}

export async function probeMediaFile(paths: ResourcePaths, filePath: string): Promise<ProbeResult> {
  const ffprobePath = resolveFfprobeExecutable(paths);
  if (!existsSync(ffprobePath)) {
    throw new Error(`Missing ffprobe executable at ${ffprobePath}`);
  }

  const output = await runProcess(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,format_name',
    '-of',
    'json',
    filePath
  ]);

  const parsed = JSON.parse(output.stdout) as { format?: { duration?: string; format_name?: string } };
  const duration = parsed.format?.duration ? Number(parsed.format.duration) : Number.NaN;

  return {
    durationSeconds: Number.isFinite(duration) ? duration : null,
    formatName: parsed.format?.format_name ?? null
  };
}

export async function prepareAudioChunks(
  paths: ResourcePaths,
  options: PrepareAudioOptions
): Promise<PreparedAudioChunk[]> {
  const ffmpegPath = resolveFfmpegExecutable(paths);
  if (!existsSync(ffmpegPath)) {
    throw new Error(`Missing ffmpeg executable at ${ffmpegPath}`);
  }

  const jobDirectory = join(options.outputDirectory, options.jobId);
  mkdirSync(jobDirectory, { recursive: true });

  const ranges = planAudioChunks(options);
  const preparedChunks: PreparedAudioChunk[] = [];

  for (const range of ranges) {
    const filePath = join(jobDirectory, `chunk-${range.index.toString().padStart(4, '0')}.wav`);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      range.startSeconds.toString()
    ];

    if (range.durationSeconds !== null) {
      args.push('-t', range.durationSeconds.toString());
    }

    args.push(
      '-i',
      options.sourcePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      filePath
    );

    await runProcess(ffmpegPath, args, undefined, options.signal);
    preparedChunks.push({
      index: range.index,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      filePath
    });
  }

  return preparedChunks;
}

export class WhisperCppCpuEngine implements TranscriptionEngine {
  readonly id = 'whisper.cpp-cpu';
  readonly backend = 'cpu';

  constructor(private readonly paths: ResourcePaths) {}

  async detect(): Promise<EngineAvailability> {
    return detectWhisperEngine(this.paths, 'cpu');
  }

  async *transcribe(input: TranscriptionInput): AsyncIterable<TranscriptionProgressEvent> {
    const availability = await this.detect();
    if (!availability.available || !availability.executablePath) {
      throw new Error(availability.reason ?? 'whisper.cpp CPU engine is unavailable');
    }

    if (!existsSync(input.modelPath)) {
      throw new Error(`Missing Whisper model at ${input.modelPath}`);
    }

    yield {
      jobId: input.jobId,
      status: 'transcribing',
      progress: 0,
      message: 'Starting whisper.cpp CPU transcription.',
      segment: null
    };

    const outputBase = join(input.outputDirectory, input.outputBaseName ?? input.jobId);
    const args = ['-m', input.modelPath, '-f', input.sourcePath, '-of', outputBase, '-oj', '-osrt', '-ovtt'];
    const progressQueue = new AsyncValueQueue<number>();
    let lastWhisperProgress = 0;
    const resultPromise = runProcess(
      availability.executablePath,
      args,
      (line) => {
        const progress = parseWhisperProgressLine(line);
        if (progress === null || progress <= lastWhisperProgress + 0.005) {
          return;
        }

        lastWhisperProgress = progress;
        progressQueue.push(progress);
      },
      input.signal
    ).finally(() => progressQueue.close());

    for await (const progress of progressQueue) {
      yield {
        jobId: input.jobId,
        status: 'transcribing',
        progress: Math.min(0.95, progress),
        message: `Whisper progress ${Math.round(progress * 100)}%.`,
        segment: null
      };
    }

    const result = await resultPromise;

    const parsedSegments = readWhisperJsonSegments(`${outputBase}.json`, input.jobId);
    const fallbackSegment: TranscriptSegment = {
      id: `seg_${crypto.randomUUID()}`,
      jobId: input.jobId,
      index: 0,
      startSeconds: 0,
      endSeconds: 0,
      text: result.stdout.trim() || result.stderr.trim() || 'Transcription completed. Output files were written by whisper.cpp.',
      confidence: null,
      createdAt: new Date().toISOString()
    };

    const segments = parsedSegments.length > 0 ? parsedSegments : [fallbackSegment];
    for (const segment of segments) {
      const segmentProgress = Math.max(0.1, Math.min(0.95, (segment.index + 1) / segments.length));
      yield {
        jobId: input.jobId,
        status: 'transcribing',
        progress: Math.max(lastWhisperProgress, segmentProgress),
        message: 'Transcript segment saved.',
        segment
      };
    }

    yield {
      jobId: input.jobId,
      status: 'completed',
      progress: 1,
      message: 'Transcription completed.',
      segment: null
    };
  }
}

export function defaultModelPath(paths: ResourcePaths, modelId: ModelId): string {
  const fileName = `ggml-${modelId}.bin`;
  return join(paths.projectRoot, 'resources', 'models', fileName);
}

export function sourceExtension(filePath: string): string {
  return extname(filePath).replace(/^\./, '').toLowerCase() || 'unknown';
}

function platformResourceDirectory(): string {
  if (process.platform === 'win32') {
    return 'win32';
  }

  if (process.platform === 'darwin') {
    return 'darwin';
  }

  return 'linux';
}

type ProcessResult = {
  stdout: string;
  stderr: string;
};

class AsyncValueQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

function runProcess(
  executablePath: string,
  args: readonly string[],
  onLine?: (line: string) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [...args], { windowsHide: true });
    const abort = () => child.kill();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdoutChunks.push(chunk);
      emitLines(chunk, onLine);
    });

    child.stderr.on('data', (chunk: string) => {
      stderrChunks.push(chunk);
      emitLines(chunk, onLine);
    });

    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });

    child.on('close', (code: number | null) => {
      signal?.removeEventListener('abort', abort);
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');

      if (signal?.aborted) {
        reject(new Error(`${basename(executablePath)} was canceled.`));
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${basename(executablePath)} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

type PlannedChunkRange = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number | null;
};

function planAudioChunks(options: PrepareAudioOptions): PlannedChunkRange[] {
  const duration = options.durationSeconds;
  if (duration === null || duration <= 0) {
    return [{ index: 0, startSeconds: 0, endSeconds: 0, durationSeconds: null }];
  }

  if (duration <= options.maxSecondsBeforeChunking) {
    return [{ index: 0, startSeconds: 0, endSeconds: duration, durationSeconds: duration }];
  }

  const ranges: PlannedChunkRange[] = [];
  const stride = Math.max(1, options.targetChunkSeconds - options.overlapSeconds);
  let start = 0;

  while (start < duration) {
    const end = Math.min(duration, start + options.targetChunkSeconds);
    ranges.push({
      index: ranges.length,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start
    });

    if (end >= duration) {
      break;
    }

    start += stride;
  }

  return ranges;
}

type WhisperJsonSegment = {
  text?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
};

function readWhisperJsonSegments(jsonPath: string, jobId: string): TranscriptSegment[] {
  if (!existsSync(jsonPath)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as { transcription?: WhisperJsonSegment[] };
  return (parsed.transcription ?? []).map((segment, index) => ({
    id: `seg_${crypto.randomUUID()}`,
    jobId,
    index,
    startSeconds: offsetToSeconds(segment.offsets?.from, segment.timestamps?.from),
    endSeconds: offsetToSeconds(segment.offsets?.to, segment.timestamps?.to),
    text: segment.text?.trim() ?? '',
    confidence: null,
    createdAt: new Date().toISOString()
  }));
}

function offsetToSeconds(offsetMilliseconds: number | undefined, timestamp: string | undefined): number {
  if (typeof offsetMilliseconds === 'number') {
    return Math.max(0, offsetMilliseconds / 1000);
  }

  if (!timestamp) {
    return 0;
  }

  const match = /^(?<hours>\d{2}):(?<minutes>\d{2}):(?<seconds>\d{2})[,.](?<milliseconds>\d{3})$/.exec(timestamp);
  if (!match?.groups) {
    return 0;
  }

  return (
    Number(match.groups.hours) * 3600 +
    Number(match.groups.minutes) * 60 +
    Number(match.groups.seconds) +
    Number(match.groups.milliseconds) / 1000
  );
}

function emitLines(chunk: string, onLine?: (line: string) => void): void {
  if (!onLine) {
    return;
  }

  for (const line of chunk.split(/\r\n|\n|\r/)) {
    if (line.trim()) {
      onLine(line);
    }
  }
}

export function parseWhisperProgressLine(line: string): number | null {
  const match = /progress\s*=\s*(?<percent>\d{1,3}(?:\.\d+)?)\s*%/i.exec(line);
  if (!match?.groups?.percent) {
    return null;
  }

  const value = Number(match.groups.percent);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value / 100));
}
