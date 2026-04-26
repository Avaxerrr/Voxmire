import { describe, expect, it } from 'vitest';
import {
  countTranscriptSegments,
  countTranscriptionChunks,
  createJobRecord,
  deleteProject,
  getJobWithSource,
  getTranscriptSegments,
  getTranscriptionChunks,
  openVoxmireDatabase,
  renameProject,
  resetInterruptedTranscriptionChunks,
  saveTranscriptionChunk,
  saveTranscriptSegment,
  updateJobEngineBackend,
  updateTranscriptionChunkStatus
} from './index';

describe('storage repositories', () => {
  it('creates a job and stores transcript segments', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 5,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Stored transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    expect(created.job.status).toBe('queued');
    expect(getTranscriptSegments(db, created.job.id)).toHaveLength(1);
    db.close();
  });

  it('updates a job backend selection', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      engineBackend: 'cuda',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 5,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    expect(updateJobEngineBackend(db, created.job.id, 'cpu')?.engineBackend).toBe('cpu');
    db.close();
  });

  it('renames the project display name without changing the source path', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 5,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    const renamed = renameProject(db, created.job.id, 'Interview draft.wav');

    expect(renamed?.sourceFile.name).toBe('Interview draft.wav');
    expect(renamed?.sourceFile.path).toBe('C:/audio/example.wav');
    db.close();
  });

  it('deletes a project and cascades transcript records without touching the stored source path', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 5,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Stored transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptionChunk(db, {
      id: 'chunk_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      filePath: 'C:/audio/chunk-0000.wav',
      status: 'completed',
      errorMessage: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      completedAt: '2026-04-23T00:01:00.000Z'
    });

    expect(countTranscriptSegments(db, created.job.id)).toBe(1);
    expect(countTranscriptionChunks(db, created.job.id)).toBe(1);
    expect(deleteProject(db, created.job.id)).toBe(true);
    expect(getJobWithSource(db, created.job.id)).toBeNull();
    expect(getTranscriptSegments(db, created.job.id)).toHaveLength(0);
    expect(getTranscriptionChunks(db, created.job.id)).toHaveLength(0);
    expect(deleteProject(db, created.job.id)).toBe(false);
    db.close();
  });

  it('stores and updates transcription chunks', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 1200,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    const chunk = saveTranscriptionChunk(db, {
      id: 'chunk_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 600,
      filePath: 'C:/audio/chunk-0000.wav',
      status: 'queued',
      errorMessage: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      completedAt: null
    });

    updateTranscriptionChunkStatus(db, chunk.id, 'completed');

    expect(getTranscriptionChunks(db, created.job.id)).toMatchObject([{ status: 'completed' }]);
    db.close();
  });

  it('resets interrupted chunks without touching completed chunks', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 1200,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    const baseChunk = {
      jobId: created.job.id,
      startSeconds: 0,
      endSeconds: 600,
      filePath: 'C:/audio/chunk.wav',
      errorMessage: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      completedAt: null
    };

    saveTranscriptionChunk(db, { ...baseChunk, id: 'chunk_1', index: 0, status: 'completed', completedAt: '2026-04-23T00:01:00.000Z' });
    saveTranscriptionChunk(db, { ...baseChunk, id: 'chunk_2', index: 1, status: 'transcribing' });

    expect(resetInterruptedTranscriptionChunks(db, created.job.id)).toBe(1);
    expect(getTranscriptionChunks(db, created.job.id)).toMatchObject([{ status: 'completed' }, { status: 'queued' }]);
    db.close();
  });
});
