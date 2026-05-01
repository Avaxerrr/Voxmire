import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExportFormat,
  ExportTextMode,
  JobStatus,
  JobWithSource,
  ModelId,
  ProjectDetails,
  TranscriptionChunk,
  TranscriptionChunkStatus,
  TranscriptionJob,
  TranscriptionProgressEvent,
  TranscriptionLanguage,
  TranscriptionOutputMode,
  TranscriptSegment
} from '@voxmire/contracts';
import { modelSupportsTranscriptionOutputMode } from '@voxmire/core';
import { defaultModelPath } from '@voxmire/engine';
import {
  abandonJobProcessingSession,
  completeJobProcessing,
  completeTranscriptionChunk,
  countTranscriptSegments,
  countTranscriptionChunks,
  createJobRecord,
  deleteProject,
  getJobWithSource,
  getProjectProcessingStats,
  getTranscriptSegments,
  listJobs,
  mergeTranscriptSegment as mergeStoredTranscriptSegment,
  renameProject,
  replaceTranscriptSegments as replaceStoredTranscriptSegments,
  resetInterruptedTranscriptionChunks,
  resetTranscriptSegmentsToOriginal as resetStoredTranscriptSegmentsToOriginal,
  saveTranscriptSegment,
  splitTranscriptSegment as splitStoredTranscriptSegment,
  startJobProcessingSession,
  startTranscriptionChunk,
  stopJobProcessingSession,
  updateJobProgress,
  updateJobStatus,
  updateTranscriptSegmentText,
  updateTranscriptSegmentTiming,
  updateTranscriptionChunkStatus
} from '@voxmire/storage';
import { ensureDirectory } from './directories';
import { createWhisperEnginePlan, promoteFallbackEngine, type WhisperEngineCandidate } from './engine-selection';
import { writeTranscriptExport } from './exports';
import { createSourceFile } from './source-files';
import { calculateChunkedProgress, offsetSegment, prepareJobChunks } from './transcription-chunks';
import type {
  CreateTranscriptionJobInput,
  ExportTranscriptOptions,
  JobRecoveryResult,
  RecoverInterruptedJobsOptions,
  VoxmireRuntimeLogInput,
  VoxmireRuntimeOptions
} from './types';

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

  updateTranscriptSegment(jobId: string, segmentId: string, text: string): TranscriptSegment | null {
    const segment = updateTranscriptSegmentText(this.options.db, jobId, segmentId, text);
    if (segment) {
      this.log({
        level: 'info',
        event: 'transcript.segment.edited',
        jobId,
        chunkId: null,
        message: `Edited transcript segment ${segment.index}.`,
        details: { segmentId, textLength: text.length }
      });
    }

    return segment;
  }

  updateTranscriptSegmentTiming(
    jobId: string,
    segmentId: string,
    startSeconds: number,
    endSeconds: number
  ): { segments: TranscriptSegment[]; error: string | null } {
    const result = updateTranscriptSegmentTiming(this.options.db, jobId, segmentId, startSeconds, endSeconds);
    this.log({
      level: result.error ? 'warn' : 'info',
      event: result.error ? 'transcript.segment.timing_rejected' : 'transcript.segment.timing_edited',
      jobId,
      chunkId: null,
      message: result.error ?? 'Edited transcript segment timing.',
      details: { segmentId, startSeconds, endSeconds }
    });
    return result;
  }

  splitTranscriptSegment(jobId: string, segmentId: string, offset: number): TranscriptSegment[] {
    const segments = splitStoredTranscriptSegment(this.options.db, jobId, segmentId, offset);
    this.log({
      level: 'info',
      event: 'transcript.segment.split',
      jobId,
      chunkId: null,
      message: 'Split transcript segment.',
      details: { segmentId, offset, segmentCount: segments.length }
    });
    return segments;
  }

  mergeTranscriptSegment(jobId: string, segmentId: string, direction: 'previous' | 'next'): TranscriptSegment[] {
    const segments = mergeStoredTranscriptSegment(this.options.db, jobId, segmentId, direction);
    this.log({
      level: 'info',
      event: 'transcript.segment.merged',
      jobId,
      chunkId: null,
      message: 'Merged transcript segments.',
      details: { segmentId, direction, segmentCount: segments.length }
    });
    return segments;
  }

  replaceTranscriptSegments(jobId: string, segments: TranscriptSegment[]): TranscriptSegment[] {
    const restoredSegments = replaceStoredTranscriptSegments(this.options.db, jobId, segments);
    this.log({
      level: 'info',
      event: 'transcript.segments.restored',
      jobId,
      chunkId: null,
      message: 'Restored transcript segment snapshot.',
      details: { segmentCount: restoredSegments.length }
    });
    return restoredSegments;
  }

  resetTranscriptSegments(jobId: string): { segments: TranscriptSegment[]; error: string | null } {
    const result = resetStoredTranscriptSegmentsToOriginal(this.options.db, jobId);
    this.log({
      level: result.error ? 'warn' : 'info',
      event: result.error ? 'transcript.segments.reset_rejected' : 'transcript.segments.reset',
      jobId,
      chunkId: null,
      message: result.error ?? 'Reset transcript segments to original snapshot.',
      details: { segmentCount: result.segments.length }
    });
    return result;
  }

  getProjectDetails(jobId: string): ProjectDetails | null {
    const current = getJobWithSource(this.options.db, jobId);
    if (!current) {
      return null;
    }

    return {
      ...current,
      segmentCount: countTranscriptSegments(this.options.db, jobId),
      chunkCount: countTranscriptionChunks(this.options.db, jobId),
      processingStats: getProjectProcessingStats(this.options.db, jobId),
      mediaAvailable: existsSync(current.sourceFile.path)
    };
  }

  renameProject(jobId: string, name: string): JobWithSource | null {
    const renamed = renameProject(this.options.db, jobId, name);
    if (renamed) {
      this.log({
        level: 'info',
        event: 'project.renamed',
        jobId,
        chunkId: null,
        message: 'Project renamed.',
        details: { name: renamed.sourceFile.name }
      });
    }

    return renamed;
  }

  deleteProject(jobId: string): { jobId: string; deleted: boolean } {
    const active = this.activeJobs.get(jobId);
    active?.abortController.abort();
    if (active?.currentChunkId) {
      updateTranscriptionChunkStatus(this.options.db, active.currentChunkId, 'canceled');
    }
    this.activeJobs.delete(jobId);

    const deleted = deleteProject(this.options.db, jobId);
    if (deleted) {
      this.log({
        level: 'warn',
        event: 'project.deleted',
        jobId,
        chunkId: null,
        message: 'Project deleted from local workspace.',
        details: null
      });
    }

    return { jobId, deleted };
  }

  async createTranscriptionJob(input: CreateTranscriptionJobInput): Promise<JobWithSource> {
    const engineBackend = input.engineBackend ?? 'cpu';
    const language = input.language ?? 'auto';
    const outputMode = input.outputMode ?? 'transcribe';
    if (!modelSupportsTranscriptionOutputMode(input.modelId, outputMode)) {
      throw new Error('Large v3 Turbo does not support Translate to English. Select Small q8_0 or full Large v3 for translation.');
    }

    const sourceFile = await createSourceFile(this.options.resources, input.sourcePath);
    const created = createJobRecord(this.options.db, {
      sourceFile,
      modelId: input.modelId,
      engineBackend,
      language,
      outputMode
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
        engineBackend,
        language,
        outputMode
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
      abandonJobProcessingSession(this.options.db, candidate.job.id);
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

    stopJobProcessingSession(this.options.db, jobId);
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

    stopJobProcessingSession(this.options.db, jobId);
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

  exportTranscript(jobId: string, format: ExportFormat, options: ExportTranscriptOptions = {}): { path: string; format: ExportFormat; textMode: ExportTextMode } {
    const exported = writeTranscriptExport(this.options.db, jobId, format, this.options.directories, options);
    this.log({
      level: 'info',
      event: 'export.created',
      jobId,
      chunkId: null,
      message: `Created ${format.toUpperCase()} export.`,
      details: exported
    });
    return exported;
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

      startJobProcessingSession(this.options.db, jobId);
      this.updateAndEmit(jobId, 'preparing', 0, 'Preparing audio...');
      this.log({
        level: 'info',
        event: 'job.prepare.started',
        jobId,
        chunkId: null,
        message: 'Preparing audio...',
        details: { sourcePath: jobWithSource.sourceFile.path }
      });

      const modelPath = defaultModelPath(this.options.resources, modelId);
      const outputDirectory = ensureDirectory(this.options.directories.engineOutputDirectory);
      const preparedDirectory = ensureDirectory(join(outputDirectory, 'prepared-audio'));

      if (!existsSync(modelPath)) {
        throw new Error(`Missing model file: ${modelPath}`);
      }

      const chunks = await prepareJobChunks(this.options.db, this.options.resources, jobWithSource, preparedDirectory, abortController.signal);
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

      this.updateAndEmit(jobId, 'transcribing', 0, 'Starting local transcription engine.');
      this.log({
        level: 'info',
        event: 'job.transcribe.started',
        jobId,
        chunkId: null,
        message: 'Starting local transcription engine.',
        details: { modelPath }
      });

      const enginePlan = createWhisperEnginePlan({
        db: this.options.db,
        resources: this.options.resources,
        requestedBackend: jobWithSource.job.engineBackend,
        jobId,
        log: (event) => this.log(event)
      });

      if (enginePlan.length === 0) {
        throw new Error(`No compatible whisper.cpp engine runtime is available for ${jobWithSource.job.engineBackend}.`);
      }

      let activeEngineIndex = 0;
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
        const result = await this.transcribeChunkWithFallback({
          jobId,
          chunk,
          chunks,
          modelPath,
          language: jobWithSource.job.language,
          outputMode: jobWithSource.job.outputMode,
          outputDirectory,
          abortController,
          activeJob,
          enginePlan,
          activeEngineIndex,
          nextSegmentIndex
        });
        if (abortController.signal.aborted) {
          return;
        }
        activeEngineIndex = result.activeEngineIndex;
        nextSegmentIndex = result.nextSegmentIndex;
        currentChunk = null;
      }

      completeJobProcessing(this.options.db, jobId);
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
      stopJobProcessingSession(this.options.db, jobId);
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
      stopJobProcessingSession(this.options.db, jobId);
      this.activeJobs.delete(jobId);
    }
  }

  private async transcribeChunkWithFallback(options: {
    jobId: string;
    chunk: TranscriptionChunk;
    chunks: TranscriptionChunk[];
    modelPath: string;
    language: TranscriptionLanguage;
    outputMode: TranscriptionOutputMode;
    outputDirectory: string;
    abortController: AbortController;
    activeJob: ActiveJob;
    enginePlan: WhisperEngineCandidate[];
    activeEngineIndex: number;
    nextSegmentIndex: number;
  }): Promise<{ activeEngineIndex: number; nextSegmentIndex: number }> {
    let activeEngineIndex = options.activeEngineIndex;
    let nextSegmentIndex = options.nextSegmentIndex;

    while (activeEngineIndex < options.enginePlan.length) {
      const candidate = options.enginePlan[activeEngineIndex];
      if (!candidate) {
        break;
      }

      let savedSegmentCount = 0;
      startTranscriptionChunk(this.options.db, options.chunk.id, candidate.engine.runtimeId);
      this.log({
        level: 'info',
        event: 'chunk.transcribe.started',
        jobId: options.jobId,
        chunkId: options.chunk.id,
        message: `Transcribing chunk ${options.chunk.index} with ${candidate.label}.`,
        details: {
          index: options.chunk.index,
          startSeconds: options.chunk.startSeconds,
          endSeconds: options.chunk.endSeconds,
          filePath: options.chunk.filePath,
          runtimeId: candidate.engine.runtimeId
        }
      });

      try {
        for await (const event of candidate.engine.transcribe({
          jobId: options.jobId,
          sourcePath: options.chunk.filePath,
          modelPath: options.modelPath,
          language: options.language,
          outputMode: options.outputMode,
          outputDirectory: options.outputDirectory,
          outputBaseName: `${options.jobId}-chunk-${options.chunk.index.toString().padStart(4, '0')}-${candidate.engine.runtimeId}`,
          signal: options.abortController.signal
        })) {
          if (options.abortController.signal.aborted) {
            return { activeEngineIndex, nextSegmentIndex };
          }

          const progress = calculateChunkedProgress(options.chunk.index, options.chunks.length, event.progress);
          const segment = event.segment
            ? saveTranscriptSegment(this.options.db, offsetSegment(event.segment, options.chunk, nextSegmentIndex++))
            : null;
          if (segment) {
            savedSegmentCount += 1;
            this.log({
              level: 'info',
              event: 'segment.saved',
              jobId: options.jobId,
              chunkId: options.chunk.id,
              message: `Saved transcript segment ${segment.index}.`,
              details: {
                segmentId: segment.id,
                startSeconds: segment.startSeconds,
                endSeconds: segment.endSeconds,
                runtimeId: candidate.engine.runtimeId
              }
            });
          }

          updateJobProgress(this.options.db, options.jobId, progress);
          this.emitProgress({
            jobId: options.jobId,
            status: 'transcribing',
            progress,
            message: segment ? 'Transcript segment saved.' : event.message,
            segment,
            engineRuntimeId: event.engineRuntimeId ?? candidate.engine.runtimeId,
            engineLabel: event.engineLabel ?? candidate.label
          });
        }

        completeTranscriptionChunk(this.options.db, options.chunk.id);
        options.activeJob.currentChunkId = null;
        this.log({
          level: 'info',
          event: 'chunk.transcribe.completed',
          jobId: options.jobId,
          chunkId: options.chunk.id,
          message: `Completed chunk ${options.chunk.index}.`,
          details: { index: options.chunk.index, runtimeId: candidate.engine.runtimeId }
        });
        return { activeEngineIndex, nextSegmentIndex };
      } catch (error) {
        if (options.abortController.signal.aborted) {
          return { activeEngineIndex, nextSegmentIndex };
        }

        const message = error instanceof Error ? error.message : 'Unknown transcription failure.';
        if (savedSegmentCount > 0) {
          throw new Error(`${candidate.label} failed after saving ${savedSegmentCount} transcript segment(s): ${message}`);
        }

        const nextCandidate = options.enginePlan[activeEngineIndex + 1];
        if (!nextCandidate) {
          throw error;
        }

        updateTranscriptionChunkStatus(this.options.db, options.chunk.id, 'queued', message);
        promoteFallbackEngine({
          db: this.options.db,
          failed: candidate,
          next: nextCandidate,
          jobId: options.jobId,
          chunkId: options.chunk.id,
          reason: message,
          log: (event) => this.log(event)
        });
        this.emitProgress({
          jobId: options.jobId,
          status: 'transcribing',
          progress: calculateChunkedProgress(options.chunk.index, options.chunks.length, 0),
          message: `Retrying with ${nextCandidate.label}.`,
          segment: null,
          engineRuntimeId: nextCandidate.engine.runtimeId,
          engineLabel: nextCandidate.label
        });
        activeEngineIndex += 1;
      }
    }

    throw new Error('No fallback whisper.cpp engine runtime could complete the transcription chunk.');
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
