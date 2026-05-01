import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getTranscriptionChunks,
  openVoxmireDatabase,
  saveTranscriptionChunk,
  saveTranscriptSegment,
  updateJobStatus
} from '@voxmire/storage';
import { createVoxmireRuntime } from './index';
import { calculateChunkedProgress } from './transcription-chunks';

describe('calculateChunkedProgress', () => {
  it('maps single-chunk whisper progress across the transcription range', () => {
    expect(calculateChunkedProgress(0, 1, 0)).toBe(0);
    expect(calculateChunkedProgress(0, 1, 0.5)).toBe(0.5);
    expect(calculateChunkedProgress(0, 1, 1)).toBe(0.99);
  });

  it('combines chunk index and current whisper progress for long jobs', () => {
    expect(calculateChunkedProgress(0, 6, 0.5)).toBeCloseTo(0.083333, 5);
    expect(calculateChunkedProgress(3, 6, 0)).toBe(0.5);
    expect(calculateChunkedProgress(5, 6, 1)).toBe(0.99);
  });
});

describe('VoxmireRuntime', () => {
  it('creates jobs and exports transcripts without Electron', async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'voxmire-runtime-'));
    const sourcePath = join(tempDirectory, 'recording.wav');
    writeFileSync(sourcePath, 'placeholder audio');

    const db = openVoxmireDatabase(':memory:');
    const runtime = createVoxmireRuntime({
      db,
      resources: { projectRoot: tempDirectory },
      directories: {
        engineOutputDirectory: join(tempDirectory, 'engine-output'),
        exportDirectory: join(tempDirectory, 'exports')
      }
    });

    const created = await runtime.createTranscriptionJob({
      sourcePath,
      modelId: 'large-v3-turbo',
      startImmediately: false
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 2,
      text: 'Runtime transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const exported = runtime.exportTranscript(created.job.id, 'txt');

    expect(runtime.listJobs()).toHaveLength(1);
    expect(created.sourceFile.name).toBe('recording.wav');
    expect(exported.path).toContain('recording');
    db.close();
  });

  it('queues interrupted jobs for recovery without rerunning completed chunks', async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'voxmire-runtime-'));
    const sourcePath = join(tempDirectory, 'recording.wav');
    writeFileSync(sourcePath, 'placeholder audio');

    const db = openVoxmireDatabase(':memory:');
    const runtime = createVoxmireRuntime({
      db,
      resources: { projectRoot: tempDirectory },
      directories: {
        engineOutputDirectory: join(tempDirectory, 'engine-output'),
        exportDirectory: join(tempDirectory, 'exports')
      }
    });

    const created = await runtime.createTranscriptionJob({
      sourcePath,
      modelId: 'large-v3-turbo',
      startImmediately: false
    });

    updateJobStatus(db, created.job.id, 'transcribing', { progress: 0.5 });
    saveTranscriptionChunk(db, {
      id: 'chunk_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 600,
      filePath: join(tempDirectory, 'chunk-0000.wav'),
      status: 'completed',
      errorMessage: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      completedAt: '2026-04-23T00:01:00.000Z'
    });
    saveTranscriptionChunk(db, {
      id: 'chunk_2',
      jobId: created.job.id,
      index: 1,
      startSeconds: 595,
      endSeconds: 1200,
      filePath: join(tempDirectory, 'chunk-0001.wav'),
      status: 'transcribing',
      errorMessage: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
      completedAt: null
    });

    const recovered = await runtime.recoverInterruptedJobs({ start: false });

    expect(recovered).toMatchObject([{ status: 'queued', resetChunkCount: 1 }]);
    expect(runtime.getJob(created.job.id)?.job.status).toBe('queued');
    expect(getTranscriptionChunks(db, created.job.id)).toMatchObject([{ status: 'completed' }, { status: 'queued' }]);
    db.close();
  });

  it('pauses queued jobs for later resume', async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'voxmire-runtime-'));
    const sourcePath = join(tempDirectory, 'recording.wav');
    writeFileSync(sourcePath, 'placeholder audio');

    const db = openVoxmireDatabase(':memory:');
    const runtime = createVoxmireRuntime({
      db,
      resources: { projectRoot: tempDirectory },
      directories: {
        engineOutputDirectory: join(tempDirectory, 'engine-output'),
        exportDirectory: join(tempDirectory, 'exports')
      }
    });

    const created = await runtime.createTranscriptionJob({
      sourcePath,
      modelId: 'large-v3-turbo',
      startImmediately: false
    });

    expect(runtime.pauseJob(created.job.id)?.status).toBe('paused');
    expect(runtime.getJob(created.job.id)?.job.status).toBe('paused');
    db.close();
  });
});
