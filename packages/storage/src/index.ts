import Database from 'better-sqlite3';
import {
  type EngineBackend,
  type JobStatus,
  type JobWithSource,
  type ModelId,
  type SourceFile,
  type TranscriptSegment,
  type TranscriptionJob,
  sourceFileSchema,
  transcriptSegmentSchema,
  transcriptionJobSchema
} from '@voxmire/contracts';

export type VoxmireDatabase = Database.Database;

export type CreateJobRecordInput = {
  sourceFile: SourceFile;
  modelId: ModelId;
  engineBackend?: EngineBackend;
};

export function openVoxmireDatabase(databasePath: string): VoxmireDatabase {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_segments_job_index ON transcript_segments(job_id, segment_index);
  `);
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
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO source_files (id, path, name, extension, size_bytes, duration_seconds, created_at)
      VALUES (@id, @path, @name, @extension, @sizeBytes, @durationSeconds, @createdAt)
    `).run(toSourceRow(sourceFile));

    db.prepare(`
      INSERT INTO jobs (id, source_file_id, status, model_id, engine_backend, progress, error_message, created_at, updated_at, completed_at)
      VALUES (@id, @sourceFileId, @status, @modelId, @engineBackend, @progress, @errorMessage, @createdAt, @updatedAt, @completedAt)
    `).run(toJobRow(parsedJob));
  });

  transaction();
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
       text = excluded.text,
       confidence = excluded.confidence`
  ).run(toSegmentRow(parsedSegment));

  return parsedSegment;
}

export function getTranscriptSegments(db: VoxmireDatabase, jobId: string): TranscriptSegment[] {
  const rows = db
    .prepare('SELECT * FROM transcript_segments WHERE job_id = ? ORDER BY segment_index ASC')
    .all(jobId);

  return rows.map(parseSegmentRow);
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
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
    confidence: value.confidence,
    createdAt: value.created_at
  });
}

function toSourceRow(sourceFile: SourceFile): Record<string, unknown> {
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

function toJobRow(job: TranscriptionJob): Record<string, unknown> {
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

function toSegmentRow(segment: TranscriptSegment): Record<string, unknown> {
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
