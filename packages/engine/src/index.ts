import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, extname, join } from 'node:path';
import type {
  EngineAvailability,
  EngineBackend,
  MachineProfile,
  ModelId,
  ResourceStatus,
  TranscriptSegment,
  TranscriptWordTiming,
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

export async function getMachineProfile(paths: ResourcePaths): Promise<MachineProfile> {
  const engines = detectWhisperEngines(paths);
  const nvidiaGpu = await detectCommand('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], 1600);
  const vulkanRuntime = await detectCommand('vulkaninfo', ['--summary'], 1600);
  const recommendedBackend = chooseRecommendedBackend(engines, nvidiaGpu.available, vulkanRuntime.available);
  const totalMemoryBytes = totalmem();

  return {
    platform: process.platform,
    arch: process.arch,
    logicalCpuCores: Math.max(1, cpus().length),
    totalMemoryBytes,
    recommendedBackend,
    recommendedModelId: chooseRecommendedModel(totalMemoryBytes),
    backends: engines.map((engine) => {
      const runtimeAvailable =
        engine.backend === 'cpu' ||
        (engine.backend === 'cuda' && nvidiaGpu.available) ||
        (engine.backend === 'vulkan' && vulkanRuntime.available);
      const runtimeOutput = engine.backend === 'cuda' ? nvidiaGpu.output : engine.backend === 'vulkan' ? vulkanRuntime.output : null;
      return {
        backend: engine.backend,
        label: engine.label,
        executableAvailable: engine.available,
        runtimeAvailable,
        recommended: engine.backend === recommendedBackend,
        reason: backendReason(engine, runtimeAvailable, runtimeOutput)
      };
    }),
    notes: buildMachineProfileNotes(nvidiaGpu, vulkanRuntime)
  };
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

function chooseRecommendedBackend(
  engines: EngineAvailability[],
  hasNvidiaGpu: boolean,
  hasVulkanRuntime: boolean
): EngineBackend {
  const available = new Map(engines.map((engine) => [engine.backend, engine.available]));
  if (available.get('cuda') && hasNvidiaGpu) {
    return 'cuda';
  }

  if (available.get('vulkan') && hasVulkanRuntime) {
    return 'vulkan';
  }

  return 'cpu';
}

function chooseRecommendedModel(totalMemoryBytes: number): ModelId {
  const gib = totalMemoryBytes / 1024 / 1024 / 1024;
  if (gib >= 24) {
    return 'large-v3';
  }

  if (gib >= 12) {
    return 'large-v3-turbo';
  }

  if (gib >= 8) {
    return 'distil-large-v3.5';
  }

  return 'medium';
}

function backendReason(engine: EngineAvailability, runtimeAvailable: boolean, runtimeOutput: string | null): string | null {
  if (!engine.available) {
    return engine.reason;
  }

  if (!runtimeAvailable) {
    return engine.backend === 'cuda'
      ? 'CUDA binary is present, but nvidia-smi did not report an NVIDIA GPU.'
      : 'Vulkan binary is present, but vulkaninfo was not available.';
  }

  if (engine.backend === 'cpu') {
    return 'CPU fallback is available.';
  }

  return runtimeOutput?.split(/\r?\n/).find(Boolean)?.trim() ?? null;
}

function buildMachineProfileNotes(
  nvidiaGpu: CommandDetectionResult,
  vulkanRuntime: CommandDetectionResult
): string[] {
  const notes = ['CPU fallback remains available for every supported machine.'];
  if (nvidiaGpu.available && nvidiaGpu.output) {
    notes.push(`NVIDIA GPU detected: ${nvidiaGpu.output.split(/\r?\n/)[0]?.trim() ?? 'available'}.`);
  }

  if (!nvidiaGpu.available) {
    notes.push('CUDA requires a whisper CUDA binary and a detectable NVIDIA runtime.');
  }

  if (!vulkanRuntime.available) {
    notes.push('Vulkan requires a whisper Vulkan binary and a local vulkaninfo runtime check.');
  }

  return notes;
}

type CommandDetectionResult = {
  available: boolean;
  output: string | null;
};

function detectCommand(command: string, args: readonly string[], timeoutMilliseconds: number): Promise<CommandDetectionResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { windowsHide: true });
    const chunks: string[] = [];
    let settled = false;
    const finish = (result: CommandDetectionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, output: null });
    }, timeoutMilliseconds);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => chunks.push(chunk));
    child.stderr.on('data', (chunk: string) => chunks.push(chunk));
    child.on('error', () => finish({ available: false, output: null }));
    child.on('close', (code: number | null) => {
      finish({ available: code === 0, output: chunks.join('').trim() || null });
    });
  });
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

export class WhisperCppEngine implements TranscriptionEngine {
  readonly id: string;

  constructor(
    private readonly paths: ResourcePaths,
    readonly backend: EngineBackend
  ) {
    this.id = `whisper.cpp-${backend}`;
  }

  async detect(): Promise<EngineAvailability> {
    return detectWhisperEngine(this.paths, this.backend);
  }

  async *transcribe(input: TranscriptionInput): AsyncIterable<TranscriptionProgressEvent> {
    const availability = await this.detect();
    if (!availability.available || !availability.executablePath) {
      throw new Error(availability.reason ?? `${availability.label} engine is unavailable`);
    }

    if (!existsSync(input.modelPath)) {
      throw new Error(`Missing Whisper model at ${input.modelPath}`);
    }

    yield {
      jobId: input.jobId,
      status: 'transcribing',
      progress: 0,
      message: `Starting ${availability.label} transcription.`,
      segment: null
    };

    const outputBase = join(input.outputDirectory, input.outputBaseName ?? input.jobId);
    const args = ['-m', input.modelPath, '-f', input.sourcePath, '-of', outputBase, '-oj', '-ojf', '-osrt', '-ovtt'];
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

export class WhisperCppCpuEngine extends WhisperCppEngine {
  constructor(paths: ResourcePaths) {
    super(paths, 'cpu');
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
  words?: WhisperJsonWord[];
  tokens?: WhisperJsonToken[];
};

type WhisperJsonWord = {
  text?: string;
  word?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  start?: number;
  end?: number;
};

type WhisperJsonToken = {
  text?: string;
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  t0?: number;
  t1?: number;
};

function readWhisperJsonSegments(jsonPath: string, jobId: string): TranscriptSegment[] {
  if (!existsSync(jsonPath)) {
    return [];
  }

  return parseWhisperJsonSegmentsPayload(JSON.parse(readFileSync(jsonPath, 'utf8')), jobId);
}

export function parseWhisperJsonSegmentsPayload(payload: unknown, jobId: string): TranscriptSegment[] {
  const parsed = payload as { transcription?: WhisperJsonSegment[] };
  return (parsed.transcription ?? []).map((segment, index) => {
    const wordTimings = parseWhisperWordTimings(segment);
    return {
    id: `seg_${crypto.randomUUID()}`,
    jobId,
    index,
    startSeconds: offsetToSeconds(segment.offsets?.from, segment.timestamps?.from),
    endSeconds: offsetToSeconds(segment.offsets?.to, segment.timestamps?.to),
    text: segment.text?.trim() ?? '',
    wordTimings,
    alignmentStatus: wordTimings.length > 0 ? 'aligned' : 'none',
    confidence: null,
    createdAt: new Date().toISOString()
    };
  });
}

function parseWhisperWordTimings(segment: WhisperJsonSegment): TranscriptWordTiming[] {
  if (segment.words && segment.words.length > 0) {
    return segment.words.flatMap(parseWhisperWordTiming).filter(isUsableWordTiming);
  }

  if (segment.tokens && segment.tokens.length > 0) {
    return parseWordTimingsFromTokens(segment.tokens);
  }

  return [];
}

function parseWhisperWordTiming(word: WhisperJsonWord): TranscriptWordTiming[] {
  const text = normalizeWhisperWordText(word.word ?? word.text ?? '');
  if (!text) {
    return [];
  }

  const startSeconds = secondsFromMixedTiming(word.offsets?.from, word.timestamps?.from, word.start);
  const endSeconds = secondsFromMixedTiming(word.offsets?.to, word.timestamps?.to, word.end);

  return [{ text, startSeconds, endSeconds }];
}

function parseWordTimingsFromTokens(tokens: WhisperJsonToken[]): TranscriptWordTiming[] {
  const wordTimings: TranscriptWordTiming[] = [];
  let current: TranscriptWordTiming | null = null;

  for (const token of tokens) {
    const rawText = token.text ?? '';
    const text = normalizeWhisperWordText(rawText);
    if (!text || isSpecialWhisperToken(text)) {
      continue;
    }

    const startSeconds = secondsFromMixedTiming(token.offsets?.from, token.timestamps?.from, token.t0);
    const endSeconds = secondsFromMixedTiming(token.offsets?.to, token.timestamps?.to, token.t1);
    const startsNewWord = current === null || /^\s/.test(rawText);

    if (startsNewWord) {
      if (current && isUsableWordTiming(current)) {
        wordTimings.push(current);
      }
      current = { text, startSeconds, endSeconds };
      continue;
    }

    current = current
      ? { text: `${current.text}${text}`, startSeconds: current.startSeconds, endSeconds }
      : { text, startSeconds, endSeconds };
  }

  if (current && isUsableWordTiming(current)) {
    wordTimings.push(current);
  }

  return wordTimings;
}

function isUsableWordTiming(word: TranscriptWordTiming): boolean {
  return word.text.trim().length > 0 && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) && word.endSeconds > word.startSeconds;
}

function isSpecialWhisperToken(text: string): boolean {
  return /^(\[.*\]|<\|.*\|>|_{2,}|BEG|END|TT_\d+)$/i.test(text.trim());
}

function normalizeWhisperWordText(value: string): string {
  return value
    .trim()
    .replace(/TT_\d+$/i, '')
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

function secondsFromMixedTiming(
  offsetMilliseconds: number | undefined,
  timestamp: string | undefined,
  seconds: number | undefined
): number {
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }

  return offsetToSeconds(offsetMilliseconds, timestamp);
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
