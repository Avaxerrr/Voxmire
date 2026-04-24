import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type {
  EngineBackend,
  ExportFormat,
  JobStatus,
  JobWithSource,
  ModelId,
  SourceFile,
  TranscriptionChunk,
  TranscriptionChunkStatus,
  TranscriptSegment,
  TranscriptionJob,
  TranscriptionProgressEvent
} from '@voxmire/contracts';
import { defaultChunkPolicy } from '@voxmire/core';
import {
  WhisperCppCpuEngine,
  defaultModelPath,
  prepareAudioChunks,
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
  getTranscriptionChunks,
  listJobs,
  resetInterruptedTranscriptionChunks,
  saveTranscriptionChunk,
  saveTranscriptSegment,
  updateJobProgress,
  updateJobStatus,
  updateTranscriptionChunkStatus,
  type VoxmireDatabase
} from '@voxmire/storage';

export type RuntimeDirectories = {
  engineOutputDirectory: string;
  exportDirectory: string;
};

export type VoxmireRuntimeOptions = {
  db: VoxmireDatabase;
  resources: ResourcePaths;
  directories: RuntimeDirectories;
  logger?: VoxmireRuntimeLogger;
  onProgress?: (event: TranscriptionProgressEvent) => void;
};

export type VoxmireRuntimeLogLevel = 'info' | 'warn' | 'error';

export type VoxmireRuntimeLogEvent = {
  timestamp: string;
  level: VoxmireRuntimeLogLevel;
  event: string;
  jobId: string | null;
  chunkId: string | null;
  message: string;
  details: Record<string, unknown> | null;
};

export type VoxmireRuntimeLogInput = Omit<VoxmireRuntimeLogEvent, 'timestamp'>;

export type VoxmireRuntimeLogger = {
  log: (event: VoxmireRuntimeLogInput) => void;
};

export type CreateTranscriptionJobInput = {
  sourcePath: string;
  modelId: ModelId;
  engineBackend?: EngineBackend;
  startImmediately?: boolean;
};

export type RecoverInterruptedJobsOptions = {
  start?: boolean;
};

export type JobRecoveryResult = {
  jobId: string;
  status: 'skipped-active' | 'queued' | 'started' | 'completed' | 'failed';
  resetChunkCount: number;
  message: string;
};

type ActiveJob = {
  abortController: AbortController;
  currentChunkId: string | null;
};

const recoverableJobStatuses: readonly JobStatus[] = ['queued', 'preparing', 'transcribing'];
const resumableChunkStatuses: readonly TranscriptionChunkStatus[] = ['queued', 'preparing', 'transcribing', 'failed'];

export class VoxmireRuntime {
  private readonly activeJobs = new Map<string, ActiveJob>();

  constructor(private readonly options: VoxmireRuntimeOptions) {}

  listJobs(): JobWithSource[] {
    return listJobs(this.options.db);
  }

  getJob(jobId: string): JobWithSource | null {
    return getJobWithSource(this.options.db, jobId);
  }

  getTranscriptSegments(jobId: string): TranscriptSegment[] {
    return getTranscriptSegments(this.options.db, jobId);
  }

  async createTranscriptionJob(input: CreateTranscriptionJobInput): Promise<JobWithSource> {
    const sourceFile = await this.createSourceFile(input.sourcePath);
    const created = createJobRecord(this.options.db, {
      sourceFile,
      modelId: input.modelId,
      engineBackend: input.engineBackend ?? 'cpu'
    });
    this.log({
      level: 'info',
      event: 'job.created',
      jobId: created.job.id,
      chunkId: null,
      message: `Created transcription job for ${sourceFile.name}.`,
      details: {
        sourcePath: sourceFile.path,
        modelId: input.modelId,
        engineBackend: input.engineBackend ?? 'cpu'
      }
    });

    if (input.startImmediately ?? true) {
      void this.runTranscriptionJob(created.job.id, input.modelId);
    }

    return created;
  }

  async recoverInterruptedJobs(options: RecoverInterruptedJobsOptions = {}): Promise<JobRecoveryResult[]> {
    const start = options.start ?? true;
    const candidates = this.listJobs().filter((entry) => recoverableJobStatuses.includes(entry.job.status));
    const results: JobRecoveryResult[] = [];

    for (const candidate of candidates) {
      if (this.activeJobs.has(candidate.job.id)) {
        results.push({
          jobId: candidate.job.id,
          status: 'skipped-active',
          resetChunkCount: 0,
          message: 'Job is already active.'
        });
        continue;
      }

      const resetChunkCount = resetInterruptedTranscriptionChunks(this.options.db, candidate.job.id);
      updateJobStatus(this.options.db, candidate.job.id, 'queued');
      this.log({
        level: 'warn',
        event: 'job.recovery.detected',
        jobId: candidate.job.id,
        chunkId: null,
        message: 'Recovering interrupted transcription job.',
        details: { previousStatus: candidate.job.status, resetChunkCount }
      });

      if (!start) {
        results.push({
          jobId: candidate.job.id,
          status: 'queued',
          resetChunkCount,
          message: 'Job queued for manual resume.'
        });
        continue;
      }

      await this.runTranscriptionJob(candidate.job.id, candidate.job.modelId);
      const recovered = this.getJob(candidate.job.id);
      const status = recovered?.job.status === 'completed' ? 'completed' : recovered?.job.status === 'failed' ? 'failed' : 'started';
      results.push({
        jobId: candidate.job.id,
        status,
        resetChunkCount,
        message: recovered ? `Recovery finished with status ${recovered.job.status}.` : 'Recovery started.'
      });
    }

    return results;
  }

  cancelJob(jobId: string): TranscriptionJob | null {
    const active = this.activeJobs.get(jobId);
    active?.abortController.abort();
    if (active?.currentChunkId) {
      updateTranscriptionChunkStatus(this.options.db, active.currentChunkId, 'canceled');
    }
    this.activeJobs.delete(jobId);

    const job = updateJobStatus(this.options.db, jobId, 'canceled', { progress: 0 });
    this.log({
      level: 'warn',
      event: 'job.canceled',
      jobId,
      chunkId: null,
      message: 'Job canceled.',
      details: null
    });
    this.emitProgress({
      jobId,
      status: 'canceled',
      progress: job?.progress ?? 0,
      message: 'Job canceled.',
      segment: null
    });

    return job;
  }

  pauseJob(jobId: string): TranscriptionJob | null {
    const active = this.activeJobs.get(jobId);
    active?.abortController.abort();
    if (active?.currentChunkId) {
      updateTranscriptionChunkStatus(this.options.db, active.currentChunkId, 'queued');
    }
    this.activeJobs.delete(jobId);

    const current = getJobWithSource(this.options.db, jobId);
    if (!current) {
      return null;
    }

    if (current.job.status === 'completed' || current.job.status === 'failed' || current.job.status === 'canceled') {
      return current.job;
    }

    const job = updateJobStatus(this.options.db, jobId, 'paused');
    this.log({
      level: 'warn',
      event: 'job.paused',
      jobId,
      chunkId: active?.currentChunkId ?? null,
      message: 'Job paused.',
      details: null
    });
    this.emitProgress({
      jobId,
      status: 'paused',
      progress: job?.progress ?? current.job.progress,
      message: 'Job paused.',
      segment: null
    });

    return job;
  }

  async resumeJob(jobId: string): Promise<JobWithSource | null> {
    const current = getJobWithSource(this.options.db, jobId);
    if (!current) {
      return null;
    }

    if (current.job.status !== 'paused' && current.job.status !== 'queued') {
      return current;
    }

    resetInterruptedTranscriptionChunks(this.options.db, jobId);
    updateJobStatus(this.options.db, jobId, 'queued');
    this.log({
      level: 'info',
      event: 'job.resumed',
      jobId,
      chunkId: null,
      message: 'Job resumed.',
      details: { previousStatus: current.job.status }
    });

    await this.runTranscriptionJob(jobId, current.job.modelId);
    return getJobWithSource(this.options.db, jobId);
  }

  exportTranscript(jobId: string, format: ExportFormat): { path: string; format: ExportFormat } {
    const jobWithSource = getJobWithSource(this.options.db, jobId);

    if (!jobWithSource) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const segments = getTranscriptSegments(this.options.db, jobId);
    const rendered = renderTranscriptExport(format, segments);
    const exportDirectory = ensureDirectory(this.options.directories.exportDirectory);
    const outputPath = join(
      exportDirectory,
      `${sanitizeFileName(jobWithSource.sourceFile.name)}-${jobId}.${exportFileExtension(format)}`
    );

    writeFileSync(outputPath, rendered, 'utf8');
    this.log({
      level: 'info',
      event: 'export.created',
      jobId,
      chunkId: null,
      message: `Created ${format.toUpperCase()} export.`,
      details: { path: outputPath, format }
    });
    return { path: outputPath, format };
  }

  async runTranscriptionJob(jobId: string, modelId: ModelId): Promise<void> {
    if (this.activeJobs.has(jobId)) {
      throw new Error(`Job is already running: ${jobId}`);
    }

    const abortController = new AbortController();
    const activeJob: ActiveJob = { abortController, currentChunkId: null };
    this.activeJobs.set(jobId, activeJob);
    let currentChunk: TranscriptionChunk | null = null;

    try {
      const jobWithSource = getJobWithSource(this.options.db, jobId);
      if (!jobWithSource) {
        throw new Error(`Job not found: ${jobId}`);
      }

      this.updateAndEmit(jobId, 'preparing', 0.05, 'Preparing local transcription job.');
      this.log({
        level: 'info',
        event: 'job.prepare.started',
        jobId,
        chunkId: null,
        message: 'Preparing local transcription job.',
        details: { sourcePath: jobWithSource.sourceFile.path }
      });

      const modelPath = defaultModelPath(this.options.resources, modelId);
      const outputDirectory = ensureDirectory(this.options.directories.engineOutputDirectory);
      const preparedDirectory = ensureDirectory(join(outputDirectory, 'prepared-audio'));

      if (!existsSync(modelPath)) {
        throw new Error(`Missing model file: ${modelPath}`);
      }

      const chunks = await this.prepareChunks(jobWithSource, preparedDirectory, abortController.signal);
      if (abortController.signal.aborted) {
        return;
      }
      this.log({
        level: 'info',
        event: 'job.prepare.completed',
        jobId,
        chunkId: null,
        message: `Prepared ${chunks.length} audio chunk(s).`,
        details: { chunkCount: chunks.length }
      });

      this.updateAndEmit(jobId, 'transcribing', 0.1, 'Starting local transcription engine.');
      this.log({
        level: 'info',
        event: 'job.transcribe.started',
        jobId,
        chunkId: null,
        message: 'Starting local transcription engine.',
        details: { modelPath }
      });

      const engine = new WhisperCppCpuEngine(this.options.resources);
      let nextSegmentIndex = getTranscriptSegments(this.options.db, jobId).length;

      for (const chunk of chunks) {
        if (chunk.status === 'completed') {
          continue;
        }

        if (!resumableChunkStatuses.includes(chunk.status)) {
          continue;
        }

        currentChunk = chunk;
        activeJob.currentChunkId = chunk.id;
        updateTranscriptionChunkStatus(this.options.db, chunk.id, 'transcribing');
        this.log({
          level: 'info',
          event: 'chunk.transcribe.started',
          jobId,
          chunkId: chunk.id,
          message: `Transcribing chunk ${chunk.index}.`,
          details: {
            index: chunk.index,
            startSeconds: chunk.startSeconds,
            endSeconds: chunk.endSeconds,
            filePath: chunk.filePath
          }
        });

        for await (const event of engine.transcribe({
          jobId,
          sourcePath: chunk.filePath,
          modelPath,
          outputDirectory,
          outputBaseName: `${jobId}-chunk-${chunk.index.toString().padStart(4, '0')}`,
          signal: abortController.signal
        })) {
          if (abortController.signal.aborted) {
            return;
          }

          const progress = calculateChunkedProgress(chunk.index, chunks.length, event.progress);
          const segment = event.segment
            ? saveTranscriptSegment(this.options.db, offsetSegment(event.segment, chunk, nextSegmentIndex++))
            : null;
          if (segment) {
            this.log({
              level: 'info',
              event: 'segment.saved',
              jobId,
              chunkId: chunk.id,
              message: `Saved transcript segment ${segment.index}.`,
              details: {
                segmentId: segment.id,
                startSeconds: segment.startSeconds,
                endSeconds: segment.endSeconds
              }
            });
          }

          updateJobProgress(this.options.db, jobId, progress);
          this.emitProgress({
            jobId,
            status: 'transcribing',
            progress,
            message: segment ? 'Transcript segment saved.' : event.message,
            segment
          });
        }

        updateTranscriptionChunkStatus(this.options.db, chunk.id, 'completed');
        activeJob.currentChunkId = null;
        this.log({
          level: 'info',
          event: 'chunk.transcribe.completed',
          jobId,
          chunkId: chunk.id,
          message: `Completed chunk ${chunk.index}.`,
          details: { index: chunk.index }
        });
      }

      this.updateAndEmit(jobId, 'completed', 1, 'Transcription completed.');
      this.log({
        level: 'info',
        event: 'job.completed',
        jobId,
        chunkId: null,
        message: 'Transcription completed.',
        details: null
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown transcription failure.';
      if (currentChunk) {
        updateTranscriptionChunkStatus(this.options.db, currentChunk.id, 'failed', message);
      }
      updateJobStatus(this.options.db, jobId, 'failed', { errorMessage: message });
      this.log({
        level: 'error',
        event: 'job.failed',
        jobId,
        chunkId: currentChunk?.id ?? null,
        message,
        details: null
      });
      this.emitProgress({ jobId, status: 'failed', progress: 0, message, segment: null });
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async prepareChunks(
    jobWithSource: JobWithSource,
    preparedDirectory: string,
    signal: AbortSignal
  ): Promise<TranscriptionChunk[]> {
    const existingChunks = getTranscriptionChunks(this.options.db, jobWithSource.job.id);
    if (existingChunks.length > 0) {
      return existingChunks;
    }

    const preparedChunks = await prepareAudioChunks(this.options.resources, {
      sourcePath: jobWithSource.sourceFile.path,
      jobId: jobWithSource.job.id,
      outputDirectory: preparedDirectory,
      durationSeconds: jobWithSource.sourceFile.durationSeconds,
      targetChunkSeconds: defaultChunkPolicy.targetSeconds,
      overlapSeconds: defaultChunkPolicy.overlapSeconds,
      maxSecondsBeforeChunking: defaultChunkPolicy.maxSecondsBeforeChunking,
      signal
    });

    const now = new Date().toISOString();
    return preparedChunks.map((chunk) =>
      saveTranscriptionChunk(this.options.db, {
        id: createId('chunk'),
        jobId: jobWithSource.job.id,
        index: chunk.index,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        filePath: chunk.filePath,
        status: 'queued',
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      })
    );
  }

  private async createSourceFile(filePath: string): Promise<SourceFile> {
    const stats = statSync(filePath);
    let durationSeconds: number | null = null;

    try {
      const probe = await probeMediaFile(this.options.resources, filePath);
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

  private updateAndEmit(jobId: string, status: JobStatus, progress: number, message: string): void {
    updateJobStatus(this.options.db, jobId, status, { progress });
    this.emitProgress({ jobId, status, progress, message, segment: null });
  }

  private emitProgress(event: TranscriptionProgressEvent): void {
    this.options.onProgress?.(event);
  }

  private log(event: VoxmireRuntimeLogInput): void {
    this.options.logger?.log(event);
  }
}

export function createVoxmireRuntime(options: VoxmireRuntimeOptions): VoxmireRuntime {
  return new VoxmireRuntime(options);
}

export function createJsonlRuntimeLogger(filePath: string): VoxmireRuntimeLogger {
  mkdirSync(dirname(filePath), { recursive: true });
  return {
    log: (event) => {
      const entry: VoxmireRuntimeLogEvent = {
        timestamp: new Date().toISOString(),
        ...event
      };
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
  };
}

function ensureDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true });
  return directory;
}

function calculateChunkedProgress(chunkIndex: number, chunkCount: number, chunkProgress: number): number {
  const safeChunkCount = Math.max(1, chunkCount);
  const transcribeProgress = (chunkIndex + Math.max(0, Math.min(1, chunkProgress))) / safeChunkCount;
  return Math.max(0.1, Math.min(0.99, 0.1 + transcribeProgress * 0.89));
}

function offsetSegment(segment: TranscriptSegment, chunk: TranscriptionChunk, index: number): TranscriptSegment {
  return {
    ...segment,
    id: createId('seg'),
    index,
    startSeconds: chunk.startSeconds + segment.startSeconds,
    endSeconds: chunk.startSeconds + segment.endSeconds
  };
}

function sanitizeFileName(value: string): string {
  const withoutExtension = value.replace(extname(value), '');
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
}
