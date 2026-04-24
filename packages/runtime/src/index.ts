import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  EngineBackend,
  ExportFormat,
  JobStatus,
  JobWithSource,
  ModelId,
  SourceFile,
  TranscriptSegment,
  TranscriptionJob,
  TranscriptionProgressEvent
} from '@voxmire/contracts';
import {
  WhisperCppCpuEngine,
  defaultModelPath,
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
  saveTranscriptSegment,
  updateJobProgress,
  updateJobStatus,
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
  onProgress?: (event: TranscriptionProgressEvent) => void;
};

export type CreateTranscriptionJobInput = {
  sourcePath: string;
  modelId: ModelId;
  engineBackend?: EngineBackend;
  startImmediately?: boolean;
};

export class VoxmireRuntime {
  private readonly activeJobs = new Map<string, AbortController>();

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

    if (input.startImmediately ?? true) {
      void this.runTranscriptionJob(created.job.id, input.modelId);
    }

    return created;
  }

  cancelJob(jobId: string): TranscriptionJob | null {
    const active = this.activeJobs.get(jobId);
    active?.abort();
    this.activeJobs.delete(jobId);

    const job = updateJobStatus(this.options.db, jobId, 'canceled', { progress: 0 });
    this.emitProgress({
      jobId,
      status: 'canceled',
      progress: job?.progress ?? 0,
      message: 'Job canceled.',
      segment: null
    });

    return job;
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
    return { path: outputPath, format };
  }

  async runTranscriptionJob(jobId: string, modelId: ModelId): Promise<void> {
    const abortController = new AbortController();
    this.activeJobs.set(jobId, abortController);

    try {
      const jobWithSource = getJobWithSource(this.options.db, jobId);
      if (!jobWithSource) {
        throw new Error(`Job not found: ${jobId}`);
      }

      this.updateAndEmit(jobId, 'preparing', 0.05, 'Preparing local transcription job.');

      const modelPath = defaultModelPath(this.options.resources, modelId);
      const outputDirectory = ensureDirectory(this.options.directories.engineOutputDirectory);

      if (!existsSync(modelPath)) {
        throw new Error(`Missing model file: ${modelPath}`);
      }

      this.updateAndEmit(jobId, 'transcribing', 0.1, 'Starting local transcription engine.');

      const engine = new WhisperCppCpuEngine(this.options.resources);
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
          saveTranscriptSegment(this.options.db, event.segment);
        }

        updateJobProgress(this.options.db, jobId, event.progress);
        this.emitProgress(event);
      }

      this.updateAndEmit(jobId, 'completed', 1, 'Transcription completed.');
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown transcription failure.';
      updateJobStatus(this.options.db, jobId, 'failed', { errorMessage: message });
      this.emitProgress({ jobId, status: 'failed', progress: 0, message, segment: null });
    } finally {
      this.activeJobs.delete(jobId);
    }
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
}

export function createVoxmireRuntime(options: VoxmireRuntimeOptions): VoxmireRuntime {
  return new VoxmireRuntime(options);
}

function ensureDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true });
  return directory;
}

function sanitizeFileName(value: string): string {
  const withoutExtension = value.replace(extname(value), '');
  return withoutExtension.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
}
