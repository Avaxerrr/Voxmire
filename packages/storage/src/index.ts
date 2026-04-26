import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  type EngineBackend,
  type JobStatus,
  type JobWithSource,
  type ModelId,
  type SourceFile,
  type TranscriptionChunk,
  type TranscriptionChunkStatus,
  type TranscriptSegment,
  type TranscriptionJob,
  sourceFileSchema,
  transcriptionChunkSchema,
  transcriptSegmentSchema,
  transcriptionJobSchema
} from '@voxmire/contracts';

export type VoxmireDatabase = DatabaseSync;

export type CreateJobRecordInput = {
  sourceFile: SourceFile;
  modelId: ModelId;
  engineBackend?: EngineBackend;
};

export function openVoxmireDatabase(databasePath: string): VoxmireDatabase {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function runMigrations(db: VoxmireDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      duration_seconds REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      model_id TEXT NOT NULL,
      engine_backend TEXT NOT NULL,
      progress REAL NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      segment_index INTEGER NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, segment_index)
    );

    CREATE TABLE IF NOT EXISTS transcription_chunks (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(job_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_segments_job_index ON transcript_segments(job_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_chunks_job_index ON transcription_chunks(job_id, chunk_index);
  `);

  ensureColumn(db, 'transcript_segments', 'original_text', 'TEXT');
  ensureColumn(db, 'transcript_segments', 'edited_at', 'TEXT');
}

export function createJobRecord(db: VoxmireDatabase, input: CreateJobRecordInput): JobWithSource {
  const now = new Date().toISOString();
  const sourceFile = sourceFileSchema.parse(input.sourceFile);
  const job: TranscriptionJob = {
    id: createId('job'),
    sourceFileId: sourceFile.id,
    status: 'queued',
    modelId: input.modelId,
    engineBackend: input.engineBackend ?? 'cpu',
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
      INSERT INTO jobs (id, source_file_id, status, model_id, engine_backend, progress, error_message, created_at, updated_at, completed_at)
      VALUES (@id, @sourceFileId, @status, @modelId, @engineBackend, @progress, @errorMessage, @createdAt, @updatedAt, @completedAt)
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

export function saveTranscriptSegment(db: VoxmireDatabase, segment: TranscriptSegment): TranscriptSegment {
  const parsedSegment = transcriptSegmentSchema.parse(segment);
  db.prepare(
    `INSERT INTO transcript_segments (id, job_id, segment_index, start_seconds, end_seconds, text, confidence, created_at)
     VALUES (@id, @jobId, @index, @startSeconds, @endSeconds, @text, @confidence, @createdAt)
     ON CONFLICT(job_id, segment_index) DO UPDATE SET
       start_seconds = excluded.start_seconds,
       end_seconds = excluded.end_seconds,
       text = CASE
         WHEN transcript_segments.edited_at IS NULL THEN excluded.text
         ELSE transcript_segments.text
       END,
       confidence = excluded.confidence`
  ).run(toSegmentRow(parsedSegment));

  return parsedSegment;
}

export function updateTranscriptSegmentText(
  db: VoxmireDatabase,
  jobId: string,
  segmentId: string,
  text: string
): TranscriptSegment | null {
  const current = getTranscriptSegment(db, jobId, segmentId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE transcript_segments
     SET text = @text,
         original_text = @originalText,
         edited_at = @editedAt
     WHERE id = @segmentId
       AND job_id = @jobId`
  ).run({
    jobId,
    segmentId,
    text,
    originalText: current.originalText ?? current.text,
    editedAt: now
  });

  return getTranscriptSegment(db, jobId, segmentId);
}

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

export function getTranscriptSegments(db: VoxmireDatabase, jobId: string): TranscriptSegment[] {
  const rows = db
    .prepare('SELECT * FROM transcript_segments WHERE job_id = ? ORDER BY segment_index ASC')
    .all(jobId);

  return rows.map(parseSegmentRow);
}

export function getTranscriptSegment(db: VoxmireDatabase, jobId: string, segmentId: string): TranscriptSegment | null {
  const row = db.prepare('SELECT * FROM transcript_segments WHERE job_id = ? AND id = ?').get(jobId, segmentId);
  return row ? parseSegmentRow(row) : null;
}

export function countTranscriptSegments(db: VoxmireDatabase, jobId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_segments WHERE job_id = ?').get(jobId) as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

export function countTranscriptionChunks(db: VoxmireDatabase, jobId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcription_chunks WHERE job_id = ?').get(jobId) as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ensureColumn(db: VoxmireDatabase, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function jobColumns(): string {
  return `j.id AS job_id, j.source_file_id AS job_source_file_id, j.status AS job_status, j.model_id AS job_model_id,
    j.engine_backend AS job_engine_backend, j.progress AS job_progress, j.error_message AS job_error_message,
    j.created_at AS job_created_at, j.updated_at AS job_updated_at, j.completed_at AS job_completed_at`;
}

function sourceColumns(): string {
  return `s.id AS source_id, s.path AS source_path, s.name AS source_name, s.extension AS source_extension,
    s.size_bytes AS source_size_bytes, s.duration_seconds AS source_duration_seconds, s.created_at AS source_created_at`;
}

function parseJobWithSourceRow(row: unknown): JobWithSource {
  const value = row as Record<string, unknown>;
  return {
    job: transcriptionJobSchema.parse({
      id: value.job_id,
      sourceFileId: value.job_source_file_id,
      status: value.job_status,
      modelId: value.job_model_id,
      engineBackend: value.job_engine_backend,
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

function parseJobRow(row: unknown): TranscriptionJob {
  const value = row as Record<string, unknown>;
  return transcriptionJobSchema.parse({
    id: value.id,
    sourceFileId: value.source_file_id,
    status: value.status,
    modelId: value.model_id,
    engineBackend: value.engine_backend,
    progress: value.progress,
    errorMessage: value.error_message,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    completedAt: value.completed_at
  });
}

function parseSegmentRow(row: unknown): TranscriptSegment {
  const value = row as Record<string, unknown>;
  return transcriptSegmentSchema.parse({
    id: value.id,
    jobId: value.job_id,
    index: value.segment_index,
    startSeconds: value.start_seconds,
    endSeconds: value.end_seconds,
    text: value.text,
    originalText: value.original_text,
    confidence: value.confidence,
    createdAt: value.created_at,
    editedAt: value.edited_at
  });
}

function parseChunkRow(row: unknown): TranscriptionChunk {
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
    completedAt: value.completed_at
  });
}

function toSourceRow(sourceFile: SourceFile): Record<string, SQLInputValue> {
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

function toJobRow(job: TranscriptionJob): Record<string, SQLInputValue> {
  return {
    id: job.id,
    sourceFileId: job.sourceFileId,
    status: job.status,
    modelId: job.modelId,
    engineBackend: job.engineBackend,
    progress: job.progress,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt
  };
}

function toChunkRow(chunk: TranscriptionChunk): Record<string, SQLInputValue> {
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
    completedAt: chunk.completedAt
  };
}

function toSegmentRow(segment: TranscriptSegment): Record<string, SQLInputValue> {
  return {
    id: segment.id,
    jobId: segment.jobId,
    index: segment.index,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: segment.text,
    confidence: segment.confidence,
    createdAt: segment.createdAt
  };
}
