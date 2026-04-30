import { DatabaseSync } from 'node:sqlite';
import type { VoxmireDatabase } from './types';

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

    CREATE TABLE IF NOT EXISTS original_transcript_segments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      segment_index INTEGER NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      text TEXT NOT NULL,
      original_text TEXT,
      word_timings TEXT,
      alignment_status TEXT,
      confidence REAL,
      created_at TEXT NOT NULL,
      edited_at TEXT,
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
      started_at TEXT,
      runtime_id TEXT,
      processing_duration_ms INTEGER,
      UNIQUE(job_id, chunk_index)
    );

    CREATE TABLE IF NOT EXISTS job_processing_metrics (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      processing_started_at TEXT,
      processing_completed_at TEXT,
      active_session_started_at TEXT,
      active_processing_duration_ms INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_segments_job_index ON transcript_segments(job_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_original_segments_job_index ON original_transcript_segments(job_id, segment_index);
    CREATE INDEX IF NOT EXISTS idx_chunks_job_index ON transcription_chunks(job_id, chunk_index);
  `);

  ensureColumn(db, 'transcript_segments', 'original_text', 'TEXT');
  ensureColumn(db, 'transcript_segments', 'edited_at', 'TEXT');
  ensureColumn(db, 'transcript_segments', 'word_timings', 'TEXT');
  ensureColumn(db, 'transcript_segments', 'alignment_status', 'TEXT');
  ensureColumn(db, 'transcription_chunks', 'started_at', 'TEXT');
  ensureColumn(db, 'transcription_chunks', 'runtime_id', 'TEXT');
  ensureColumn(db, 'transcription_chunks', 'processing_duration_ms', 'INTEGER');
}

function ensureColumn(db: VoxmireDatabase, tableName: string, columnName: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
