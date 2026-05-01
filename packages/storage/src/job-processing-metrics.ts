import { engineRuntimeIdSchema, type EngineRuntimeId, type TranscriptionJobProcessingStats } from '@voxmire/contracts';
import type { VoxmireDatabase } from './types';

type JobProcessingMetricRow = {
  processing_started_at: string | null;
  processing_completed_at: string | null;
  active_session_started_at: string | null;
  active_processing_duration_ms: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function millisecondsBetween(startedAt: string | null, completedAt: string): number {
  if (!startedAt) {
    return 0;
  }

  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return 0;
  }

  return completed - started;
}

export function startJobProcessingSession(db: VoxmireDatabase, jobId: string): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO job_processing_metrics (
       job_id, processing_started_at, processing_completed_at, active_session_started_at, active_processing_duration_ms, updated_at
     )
     VALUES (@jobId, @now, NULL, @now, 0, @now)
     ON CONFLICT(job_id) DO UPDATE SET
       processing_started_at = COALESCE(processing_started_at, excluded.processing_started_at),
       processing_completed_at = NULL,
       active_session_started_at = COALESCE(active_session_started_at, excluded.active_session_started_at),
       updated_at = excluded.updated_at`
  ).run({ jobId, now });
}

export function stopJobProcessingSession(db: VoxmireDatabase, jobId: string): void {
  const now = nowIso();
  const row = getMetricRow(db, jobId);
  if (!row?.active_session_started_at) {
    return;
  }

  const activeDurationMs = Number(row.active_processing_duration_ms ?? 0) + millisecondsBetween(row.active_session_started_at, now);
  db.prepare(
    `UPDATE job_processing_metrics
     SET active_session_started_at = NULL,
         active_processing_duration_ms = @activeDurationMs,
         updated_at = @updatedAt
     WHERE job_id = @jobId`
  ).run({ jobId, activeDurationMs, updatedAt: now });
}

export function abandonJobProcessingSession(db: VoxmireDatabase, jobId: string): void {
  db.prepare(
    `UPDATE job_processing_metrics
     SET active_session_started_at = NULL,
         updated_at = @updatedAt
     WHERE job_id = @jobId`
  ).run({ jobId, updatedAt: nowIso() });
}

export function completeJobProcessing(db: VoxmireDatabase, jobId: string): void {
  stopJobProcessingSession(db, jobId);
  const now = nowIso();
  const row = getMetricRow(db, jobId);
  const chunkDurationMs = getCompletedChunkDurationMs(db, jobId);
  const activeDurationMs = Math.max(Number(row?.active_processing_duration_ms ?? 0), chunkDurationMs);

  db.prepare(
    `INSERT INTO job_processing_metrics (
       job_id, processing_started_at, processing_completed_at, active_session_started_at, active_processing_duration_ms, updated_at
     )
     VALUES (@jobId, @now, @now, NULL, @activeDurationMs, @now)
     ON CONFLICT(job_id) DO UPDATE SET
       processing_started_at = COALESCE(processing_started_at, excluded.processing_started_at),
       processing_completed_at = excluded.processing_completed_at,
       active_session_started_at = NULL,
       active_processing_duration_ms = @activeDurationMs,
       updated_at = excluded.updated_at`
  ).run({ jobId, now, activeDurationMs });
}

export function getProjectProcessingStats(db: VoxmireDatabase, jobId: string): TranscriptionJobProcessingStats | null {
  const metricRow = getMetricRow(db, jobId);
  const chunks = db
    .prepare(
      `SELECT id, chunk_index, started_at, completed_at, runtime_id, processing_duration_ms
       FROM transcription_chunks
       WHERE job_id = ?
       ORDER BY chunk_index ASC`
    )
    .all(jobId)
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: String(value.id),
        index: Number(value.chunk_index),
        startedAt: typeof value.started_at === 'string' ? value.started_at : null,
        completedAt: typeof value.completed_at === 'string' ? value.completed_at : null,
        runtimeId: parseRuntimeId(value.runtime_id),
        processingDurationMs: typeof value.processing_duration_ms === 'number' ? value.processing_duration_ms : null
      };
    });

  if (!metricRow && chunks.every((chunk) => !chunk.startedAt && !chunk.runtimeId && chunk.processingDurationMs === null)) {
    return null;
  }

  const completedDurations = chunks
    .map((chunk) => chunk.processingDurationMs)
    .filter((durationMs): durationMs is number => typeof durationMs === 'number' && durationMs >= 0);
  const averageChunkDurationMs =
    completedDurations.length > 0
      ? Math.round(completedDurations.reduce((total, durationMs) => total + durationMs, 0) / completedDurations.length)
      : null;

  return {
    startedAt: metricRow?.processing_started_at ?? firstNonNull(chunks.map((chunk) => chunk.startedAt)),
    completedAt: metricRow?.processing_completed_at ?? null,
    activeDurationMs: metricRow ? Number(metricRow.active_processing_duration_ms ?? 0) : averageChunkDurationMs,
    averageChunkDurationMs,
    completedChunkCount: completedDurations.length,
    chunks
  };
}

function getMetricRow(db: VoxmireDatabase, jobId: string): JobProcessingMetricRow | null {
  const row = db.prepare('SELECT * FROM job_processing_metrics WHERE job_id = ?').get(jobId);
  return row ? (row as JobProcessingMetricRow) : null;
}

function getCompletedChunkDurationMs(db: VoxmireDatabase, jobId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(processing_duration_ms), 0) AS total
       FROM transcription_chunks
       WHERE job_id = ?
         AND status = 'completed'
         AND processing_duration_ms IS NOT NULL`
    )
    .get(jobId) as { total?: number } | undefined;

  return Number(row?.total ?? 0);
}

function firstNonNull(values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function parseRuntimeId(value: unknown): EngineRuntimeId | null {
  const result = engineRuntimeIdSchema.safeParse(value);
  return result.success ? result.data : null;
}