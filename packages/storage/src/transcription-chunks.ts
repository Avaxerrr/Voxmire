import {
  type TranscriptionChunk,
  type TranscriptionChunkStatus,
  transcriptionChunkSchema
} from '@voxmire/contracts';
import { parseChunkRow, toChunkRow } from './rows';
import type { VoxmireDatabase } from './types';

export function saveTranscriptionChunk(db: VoxmireDatabase, chunk: TranscriptionChunk): TranscriptionChunk {
  const parsedChunk = transcriptionChunkSchema.parse(chunk);
  db.prepare(
    `INSERT INTO transcription_chunks (
       id, job_id, chunk_index, start_seconds, end_seconds, file_path, status, error_message, created_at, updated_at, completed_at
     )
     VALUES (
       @id, @jobId, @index, @startSeconds, @endSeconds, @filePath, @status, @errorMessage, @createdAt, @updatedAt, @completedAt
     )
     ON CONFLICT(job_id, chunk_index) DO UPDATE SET
       start_seconds = excluded.start_seconds,
       end_seconds = excluded.end_seconds,
       file_path = excluded.file_path,
       status = excluded.status,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`
  ).run(toChunkRow(parsedChunk));

  return parsedChunk;
}

export function getTranscriptionChunks(db: VoxmireDatabase, jobId: string): TranscriptionChunk[] {
  const rows = db
    .prepare('SELECT * FROM transcription_chunks WHERE job_id = ? ORDER BY chunk_index ASC')
    .all(jobId);

  return rows.map(parseChunkRow);
}

export function updateTranscriptionChunkStatus(
  db: VoxmireDatabase,
  chunkId: string,
  status: TranscriptionChunkStatus,
  errorMessage: string | null = null
): TranscriptionChunk | null {
  const now = new Date().toISOString();
  const completedAt = status === 'completed' ? now : null;

  db.prepare(
    `UPDATE transcription_chunks
     SET status = @status,
         error_message = @errorMessage,
         updated_at = @updatedAt,
         completed_at = @completedAt
     WHERE id = @id`
  ).run({ id: chunkId, status, errorMessage, updatedAt: now, completedAt });

  return getTranscriptionChunk(db, chunkId);
}

export function resetInterruptedTranscriptionChunks(db: VoxmireDatabase, jobId: string): number {
  const result = db.prepare(
    `UPDATE transcription_chunks
     SET status = 'queued',
         error_message = NULL,
         updated_at = @updatedAt,
         completed_at = NULL
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
