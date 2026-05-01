import {
  type EngineBackend,
  type JobStatus,
  type JobWithSource,
  type TranscriptionJob,
  sourceFileSchema,
  transcriptionJobSchema
} from '@voxmire/contracts';
import { createId } from './ids';
import { jobColumns, parseJobRow, parseJobWithSourceRow, sourceColumns, toJobRow, toSourceRow } from './rows';
import type { CreateJobRecordInput, VoxmireDatabase } from './types';

export function createJobRecord(db: VoxmireDatabase, input: CreateJobRecordInput): JobWithSource {
  const now = new Date().toISOString();
  const sourceFile = sourceFileSchema.parse(input.sourceFile);
  const job: TranscriptionJob = {
    id: createId('job'),
    sourceFileId: sourceFile.id,
    status: 'queued',
    modelId: input.modelId,
    engineBackend: input.engineBackend ?? 'cpu',
    language: input.language ?? 'auto',
    outputMode: input.outputMode ?? 'transcribe',
    progress: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  const parsedJob = transcriptionJobSchema.parse(job);
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO source_files (id, path, name, extension, size_bytes, duration_seconds, created_at)
      VALUES (@id, @path, @name, @extension, @sizeBytes, @durationSeconds, @createdAt)
    `).run(toSourceRow(sourceFile));

    db.prepare(`
      INSERT INTO jobs (id, source_file_id, status, model_id, engine_backend, language, output_mode, progress, error_message, created_at, updated_at, completed_at)
      VALUES (@id, @sourceFileId, @status, @modelId, @engineBackend, @language, @outputMode, @progress, @errorMessage, @createdAt, @updatedAt, @completedAt)
    `).run(toJobRow(parsedJob));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { job: parsedJob, sourceFile };
}

export function listJobs(db: VoxmireDatabase): JobWithSource[] {
  const rows = db
    .prepare(
      `SELECT ${jobColumns()}, ${sourceColumns()}
       FROM jobs j
       INNER JOIN source_files s ON s.id = j.source_file_id
       ORDER BY j.created_at DESC`
    )
    .all();

  return rows.map(parseJobWithSourceRow);
}

export function getJobWithSource(db: VoxmireDatabase, jobId: string): JobWithSource | null {
  const row = db
    .prepare(
      `SELECT ${jobColumns()}, ${sourceColumns()}
       FROM jobs j
       INNER JOIN source_files s ON s.id = j.source_file_id
       WHERE j.id = ?`
    )
    .get(jobId);

  return row ? parseJobWithSourceRow(row) : null;
}

export function renameProject(db: VoxmireDatabase, jobId: string, name: string): JobWithSource | null {
  const current = getJobWithSource(db, jobId);
  if (!current) {
    return null;
  }

  const nextName = name.trim();
  db.prepare('UPDATE source_files SET name = ? WHERE id = ?').run(nextName, current.sourceFile.id);
  db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), jobId);

  return getJobWithSource(db, jobId);
}

export function deleteProject(db: VoxmireDatabase, jobId: string): boolean {
  const current = getJobWithSource(db, jobId);
  if (!current) {
    return false;
  }

  db.exec('BEGIN');
  try {
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    db.prepare(
      `DELETE FROM source_files
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_file_id = ?)`
    ).run(current.sourceFile.id, current.sourceFile.id);
    db.exec('COMMIT');
    return Number(result.changes) > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateJobStatus(
  db: VoxmireDatabase,
  jobId: string,
  status: JobStatus,
  options: { errorMessage?: string | null; progress?: number } = {}
): TranscriptionJob | null {
  const now = new Date().toISOString();
  const completedAt = status === 'completed' ? now : null;
  const progress = options.progress ?? (status === 'completed' ? 1 : undefined);

  db.prepare(
    `UPDATE jobs
     SET status = @status,
         progress = COALESCE(@progress, progress),
         error_message = @errorMessage,
         updated_at = @updatedAt,
         completed_at = @completedAt
     WHERE id = @id`
  ).run({
    id: jobId,
    status,
    progress: progress ?? null,
    errorMessage: options.errorMessage ?? null,
    updatedAt: now,
    completedAt
  });

  return getJob(db, jobId);
}

export function updateJobEngineBackend(db: VoxmireDatabase, jobId: string, engineBackend: EngineBackend): TranscriptionJob | null {
  db.prepare('UPDATE jobs SET engine_backend = ?, updated_at = ? WHERE id = ?').run(
    engineBackend,
    new Date().toISOString(),
    jobId
  );

  return getJob(db, jobId);
}

export function updateJobProgress(db: VoxmireDatabase, jobId: string, progress: number): TranscriptionJob | null {
  db.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?').run(
    clampProgress(progress),
    new Date().toISOString(),
    jobId
  );

  return getJob(db, jobId);
}

export function getJob(db: VoxmireDatabase, jobId: string): TranscriptionJob | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  return row ? parseJobRow(row) : null;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}
