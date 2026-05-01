import {
  type EngineRuntimeId,
  type TranscriptionChunk,
  type TranscriptionChunkStatus,
  transcriptionChunkSchema
} from '@voxmire/contracts';
import { parseChunkRow, toChunkRow } from './rows';
import type { VoxmireDatabase } from './types';

type ChunkMetricRow = {
  started_at: string | null;
  runtime_id: string | null;
};

export function saveTranscriptionChunk(db: VoxmireDatabase, chunk: TranscriptionChunk): TranscriptionChunk {
  const parsedChunk = transcriptionChunkSchema.parse(chunk);
  db.prepare(
    `INSERT INTO transcription_chunks (
       id, job_id, chunk_index, start_seconds, end_seconds, file_path, status, error_message,
       created_at, updated_at, completed_at, started_at, runtime_id, processing_duration_ms
     )
     VALUES (
       @id, @jobId, @index, @startSeconds, @endSeconds, @filePath, @status, @errorMessage,
       @createdAt, @updatedAt, @completedAt, @startedAt, @runtimeId, @processingDurationMs
     )
     ON CONFLICT(job_id, chunk_index) DO UPDATE SET
       start_seconds = excluded.start_seconds,
       end_seconds = excluded.end_seconds,
       file_path = excluded.file_path,
       status = excluded.status,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at,
       started_at = excluded.started_at,
       runtime_id = excluded.runtime_id,
       processing_duration_ms = excluded.processing_duration_ms`
  ).run(toChunkRow(parsedChunk));

  return parsedChunk;
}

export function getTranscriptionChunks(db: VoxmireDatabase, jobId: string): TranscriptionChunk[] {
  const rows = db
    .prepare('SELECT * FROM transcription_chunks WHERE job_id = ? ORDER BY chunk_index ASC')
    .all(jobId);

  return rows.map(parseChunkRow);
}

export function startTranscriptionChunk(db: VoxmireDatabase, chunkId: string, runtimeId: EngineRuntimeId): TranscriptionChunk | null {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE transcription_chunks
     SET status = 'transcribing',
         error_message = NULL,
         updated_at = @updatedAt,
         completed_at = NULL,
         started_at = @startedAt,
         runtime_id = @runtimeId,
         processing_duration_ms = NULL
     WHERE id = @id`
  ).run({ id: chunkId, updatedAt: now, startedAt: now, runtimeId });

  return getTranscriptionChunk(db, chunkId);
}

export function completeTranscriptionChunk(db: VoxmireDatabase, chunkId: string): TranscriptionChunk | null {
  return updateTranscriptionChunkStatus(db, chunkId, 'completed');
}

export function updateTranscriptionChunkStatus(
  db: VoxmireDatabase,
  chunkId: string,
  status: TranscriptionChunkStatus,
  errorMessage: string | null = null
): TranscriptionChunk | null {
  const now = new Date().toISOString();
  const current = getChunkMetricRow(db, chunkId);
  const completedAt = status === 'completed' ? now : null;
  const startedAt = nextStartedAt(status, current?.started_at ?? null, now);
  const runtimeId = status === 'queued' ? null : current?.runtime_id ?? null;
  const processingDurationMs = status === 'completed' ? millisecondsBetween(startedAt, now) : null;

  db.prepare(
    `UPDATE transcription_chunks
     SET status = @status,
         error_message = @errorMessage,
         updated_at = @updatedAt,
         completed_at = @completedAt,
         started_at = @startedAt,
         runtime_id = @runtimeId,
         processing_duration_ms = @processingDurationMs
     WHERE id = @id`
  ).run({ id: chunkId, status, errorMessage, updatedAt: now, completedAt, startedAt, runtimeId, processingDurationMs });

  return getTranscriptionChunk(db, chunkId);
}

export function resetInterruptedTranscriptionChunks(db: VoxmireDatabase, jobId: string): number {
  const result = db.prepare(
    `UPDATE transcription_chunks
     SET status = 'queued',
         error_message = NULL,
         updated_at = @updatedAt,
         completed_at = NULL,
         started_at = NULL,
         runtime_id = NULL,
         processing_duration_ms = NULL
     WHERE job_id = @jobId
       AND status IN ('preparing', 'transcribing')`
  ).run({ jobId, updatedAt: new Date().toISOString() });

  return Number(result.changes);
}

export function getTranscriptionChunk(db: VoxmireDatabase, chunkId: string): TranscriptionChunk | null {
  const row = db.prepare('SELECT * FROM transcription_chunks WHERE id = ?').get(chunkId);
  return row ? parseChunkRow(row) : null;
}

export function countTranscriptionChunks(db: VoxmireDatabase, jobId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcription_chunks WHERE job_id = ?').get(jobId) as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function getChunkMetricRow(db: VoxmireDatabase, chunkId: string): ChunkMetricRow | null {
  const row = db.prepare('SELECT started_at, runtime_id FROM transcription_chunks WHERE id = ?').get(chunkId);
  return row ? (row as ChunkMetricRow) : null;
}

function nextStartedAt(status: TranscriptionChunkStatus, currentStartedAt: string | null, now: string): string | null {
  if (status === 'transcribing') {
    return currentStartedAt ?? now;
  }

  if (status === 'queued') {
    return null;
  }

  return currentStartedAt;
}

function millisecondsBetween(startedAt: string | null, completedAt: string): number | null {
  if (!startedAt) {
    return null;
  }

  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return null;
  }

  return completed - started;
}
