import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EngineAvailability,
  EngineBackend,
  EngineRuntimeId,
  TranscriptSegment,
  TranscriptionProgressEvent
} from '@voxmire/contracts';
import { detectWhisperRuntime } from './machine-profile';
import { AsyncValueQueue, runProcess } from './process-runner';
import { whisperRuntimeDefinition } from './resources';
import type { ResourcePaths, TranscriptionEngine, TranscriptionInput } from './types';
import { readWhisperJsonSegments } from './whisper-json';
import { parseWhisperProgressLine } from './whisper-progress';

export class WhisperCppEngine implements TranscriptionEngine {
  readonly id: string;
  readonly backend: EngineBackend;
  readonly runtimeId: EngineRuntimeId;

  constructor(
    private readonly paths: ResourcePaths,
    runtimeId: EngineRuntimeId = 'cpu'
  ) {
    const definition = whisperRuntimeDefinition(runtimeId);
    this.runtimeId = runtimeId;
    this.backend = definition.backend;
    this.id = `whisper.cpp-${runtimeId}`;
  }

  async detect(): Promise<EngineAvailability> {
    return detectWhisperRuntime(this.paths, this.runtimeId);
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
    const runtimeArgs = whisperRuntimeDefinition(this.runtimeId).extraArgs;
    const args = ['-m', input.modelPath, '-f', input.sourcePath, '-of', outputBase, '-oj', '-ojf', '-osrt', '-ovtt', ...runtimeArgs];
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