import type { SQLInputValue } from 'node:sqlite';
import {
  type JobWithSource,
  type SourceFile,
  type TranscriptAlignmentStatus,
  type TranscriptionChunk,
  type TranscriptSegment,
  type TranscriptWordTiming,
  type TranscriptionJob,
  sourceFileSchema,
  transcriptAlignmentStatusSchema,
  transcriptionChunkSchema,
  transcriptSegmentSchema,
  transcriptWordTimingSchema,
  transcriptionJobSchema
} from '@voxmire/contracts';

export function jobColumns(): string {
  return `j.id AS job_id, j.source_file_id AS job_source_file_id, j.status AS job_status, j.model_id AS job_model_id,
    j.engine_backend AS job_engine_backend, j.language AS job_language, j.output_mode AS job_output_mode, j.progress AS job_progress, j.error_message AS job_error_message,
    j.created_at AS job_created_at, j.updated_at AS job_updated_at, j.completed_at AS job_completed_at`;
}

export function sourceColumns(): string {
  return `s.id AS source_id, s.path AS source_path, s.name AS source_name, s.extension AS source_extension,
    s.size_bytes AS source_size_bytes, s.duration_seconds AS source_duration_seconds, s.created_at AS source_created_at`;
}

export function parseJobWithSourceRow(row: unknown): JobWithSource {
  const value = row as Record<string, unknown>;
  return {
    job: transcriptionJobSchema.parse({
      id: value.job_id,
      sourceFileId: value.job_source_file_id,
      status: value.job_status,
      modelId: value.job_model_id,
      engineBackend: value.job_engine_backend,
      language: value.job_language ?? 'auto',
      outputMode: value.job_output_mode ?? 'transcribe',
      progress: value.job_progress,
      errorMessage: value.job_error_message,
      createdAt: value.job_created_at,
      updatedAt: value.job_updated_at,
      completedAt: value.job_completed_at
    }),
    sourceFile: sourceFileSchema.parse({
      id: value.source_id,
      path: value.source_path,
      name: value.source_name,
      extension: value.source_extension,
      sizeBytes: value.source_size_bytes,
      durationSeconds: value.source_duration_seconds,
      createdAt: value.source_created_at
    })
  };
}

export function parseJobRow(row: unknown): TranscriptionJob {
  const value = row as Record<string, unknown>;
  return transcriptionJobSchema.parse({
    id: value.id,
    sourceFileId: value.source_file_id,
    status: value.status,
    modelId: value.model_id,
    engineBackend: value.engine_backend,
    language: value.language ?? 'auto',
    outputMode: value.output_mode ?? 'transcribe',
    progress: value.progress,
    errorMessage: value.error_message,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    completedAt: value.completed_at
  });
}

export function parseSegmentRow(row: unknown): TranscriptSegment {
  const value = row as Record<string, unknown>;
  return transcriptSegmentSchema.parse({
    id: value.id,
    jobId: value.job_id,
    index: value.segment_index,
    startSeconds: value.start_seconds,
    endSeconds: value.end_seconds,
    text: value.text,
    originalText: value.original_text,
    wordTimings: parseWordTimings(value.word_timings),
    alignmentStatus: parseAlignmentStatus(value.alignment_status),
    confidence: value.confidence,
    createdAt: value.created_at,
    editedAt: value.edited_at
  });
}

export function parseChunkRow(row: unknown): TranscriptionChunk {
  const value = row as Record<string, unknown>;
  return transcriptionChunkSchema.parse({
    id: value.id,
    jobId: value.job_id,
    index: value.chunk_index,
    startSeconds: value.start_seconds,
    endSeconds: value.end_seconds,
    filePath: value.file_path,
    status: value.status,
    errorMessage: value.error_message,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    completedAt: value.completed_at,
    startedAt: value.started_at,
    runtimeId: value.runtime_id,
    processingDurationMs: value.processing_duration_ms
  });
}

export function toSourceRow(sourceFile: SourceFile): Record<string, SQLInputValue> {
  return {
    id: sourceFile.id,
    path: sourceFile.path,
    name: sourceFile.name,
    extension: sourceFile.extension,
    sizeBytes: sourceFile.sizeBytes,
    durationSeconds: sourceFile.durationSeconds,
    createdAt: sourceFile.createdAt
  };
}

export function toJobRow(job: TranscriptionJob): Record<string, SQLInputValue> {
  return {
    id: job.id,
    sourceFileId: job.sourceFileId,
    status: job.status,
    modelId: job.modelId,
    engineBackend: job.engineBackend,
    language: job.language,
    outputMode: job.outputMode,
    progress: job.progress,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt
  };
}

export function toChunkRow(chunk: TranscriptionChunk): Record<string, SQLInputValue> {
  return {
    id: chunk.id,
    jobId: chunk.jobId,
    index: chunk.index,
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    filePath: chunk.filePath,
    status: chunk.status,
    errorMessage: chunk.errorMessage,
    createdAt: chunk.createdAt,
    updatedAt: chunk.updatedAt,
    completedAt: chunk.completedAt,
    startedAt: chunk.startedAt ?? null,
    runtimeId: chunk.runtimeId ?? null,
    processingDurationMs: chunk.processingDurationMs ?? null
  };
}

export function toSegmentRow(segment: TranscriptSegment): Record<string, SQLInputValue> {
  return {
    id: segment.id,
    jobId: segment.jobId,
    index: segment.index,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: segment.text,
    originalText: segment.originalText ?? null,
    wordTimings: serializeWordTimings(segment.wordTimings),
    alignmentStatus: segment.alignmentStatus ?? defaultAlignmentStatus(segment.wordTimings),
    confidence: segment.confidence,
    createdAt: segment.createdAt,
    editedAt: segment.editedAt ?? null
  };
}

export function serializeWordTimings(wordTimings: TranscriptWordTiming[] | undefined): string | null {
  return wordTimings && wordTimings.length > 0 ? JSON.stringify(wordTimings) : null;
}

export function defaultAlignmentStatus(wordTimings: TranscriptWordTiming[] | undefined): TranscriptAlignmentStatus {
  return wordTimings && wordTimings.length > 0 ? 'aligned' : 'none';
}

function parseWordTimings(value: unknown): TranscriptWordTiming[] | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    const result = transcriptWordTimingSchema.array().safeParse(parsed);
    return result.success && result.data.length > 0 ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseAlignmentStatus(value: unknown): TranscriptAlignmentStatus | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const result = transcriptAlignmentStatusSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
