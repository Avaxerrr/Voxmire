import { describe, expect, it } from 'vitest';
import {
  countTranscriptSegments,
  countTranscriptionChunks,
  createJobRecord,
  deleteProject,
  getJobWithSource,
  getTranscriptSegments,
  getTranscriptionChunks,
  mergeTranscriptSegment,
  openVoxmireDatabase,
  renameProject,
  resetInterruptedTranscriptionChunks,
  saveTranscriptionChunk,
  saveTranscriptSegment,
  splitTranscriptSegment,
  updateJobEngineBackend,
  updateTranscriptSegmentTiming,
  updateTranscriptSegmentText,
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

  it('updates transcript segment text and preserves the original text', () => {
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

    const segment = saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Generated transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const edited = updateTranscriptSegmentText(db, created.job.id, segment.id, 'Edited transcript.');

    expect(edited?.text).toBe('Edited transcript.');
    expect(edited?.originalText).toBe('Generated transcript.');
    expect(edited?.editedAt).toEqual(expect.any(String));
    expect(updateTranscriptSegmentText(db, created.job.id, 'missing', 'Nope')).toBeNull();
    db.close();
  });

  it('does not overwrite edited text when a generated segment is saved again', () => {
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

    const segment = saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Generated transcript.',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    updateTranscriptSegmentText(db, created.job.id, segment.id, 'Edited transcript.');

    saveTranscriptSegment(db, {
      ...segment,
      id: 'seg_2',
      text: 'Generated transcript replacement.'
    });

    expect(getTranscriptSegments(db, created.job.id)[0]?.text).toBe('Edited transcript.');
    db.close();
  });

  it('splits a transcript segment and reindexes later segments', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 10,
      text: 'Hello world',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptSegment(db, {
      id: 'seg_2',
      jobId: created.job.id,
      index: 1,
      startSeconds: 10,
      endSeconds: 12,
      text: 'After split.',
      confidence: 0.9,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const segments = splitTranscriptSegment(db, created.job.id, 'seg_1', 5);

    expect(segments.map((segment) => segment.index)).toEqual([0, 1, 2]);
    expect(segments.map((segment) => segment.text)).toEqual(['Hello', 'world', 'After split.']);
    expect(segments[0]?.endSeconds).toBeCloseTo(4.545, 3);
    expect(segments[1]?.startSeconds).toBeCloseTo(4.545, 3);
    expect(segments[0]?.editedAt).toEqual(expect.any(String));
    expect(segments[1]?.editedAt).toEqual(expect.any(String));
    db.close();
  });

  it('preserves word timing metadata across split and merge edits', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Hello world again',
      wordTimings: [
        { text: 'Hello', startSeconds: 0.2, endSeconds: 0.7 },
        { text: 'world', startSeconds: 1.1, endSeconds: 1.7 },
        { text: 'again', startSeconds: 2.2, endSeconds: 2.9 }
      ],
      alignmentStatus: 'aligned',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const splitSegments = splitTranscriptSegment(db, created.job.id, 'seg_1', 5);

    expect(splitSegments.map((segment) => segment.text)).toEqual(['Hello', 'world again']);
    expect(splitSegments[0]?.wordTimings).toEqual([
      { text: 'Hello', startSeconds: 0.2, endSeconds: 0.7 }
    ]);
    expect(splitSegments[1]?.wordTimings).toEqual([
      { text: 'world', startSeconds: 1.1, endSeconds: 1.7 },
      { text: 'again', startSeconds: 2.2, endSeconds: 2.9 }
    ]);
    expect(splitSegments[0]?.endSeconds).toBeCloseTo(1.1);
    expect(splitSegments[1]?.startSeconds).toBeCloseTo(1.1);
    expect(splitSegments[0]?.alignmentStatus).toBe('aligned');
    expect(splitSegments[1]?.alignmentStatus).toBe('aligned');

    const mergedSegments = mergeTranscriptSegment(db, created.job.id, splitSegments[1]?.id ?? '', 'previous');

    expect(mergedSegments).toHaveLength(1);
    expect(mergedSegments[0]?.text).toBe('Hello world again');
    expect(mergedSegments[0]?.alignmentStatus).toBe('aligned');
    expect(mergedSegments[0]?.wordTimings?.map((word) => word.text)).toEqual(['Hello', 'world', 'again']);
    db.close();
  });

  it('uses word timing instead of character ratio when splitting before a delayed final word', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 10,
      text: 'We wait now',
      wordTimings: [
        { text: 'We', startSeconds: 0.1, endSeconds: 0.3 },
        { text: 'wait', startSeconds: 0.4, endSeconds: 0.8 },
        { text: 'now', startSeconds: 8.5, endSeconds: 9 }
      ],
      alignmentStatus: 'aligned',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const splitSegments = splitTranscriptSegment(db, created.job.id, 'seg_1', 'We wait '.length);

    expect(splitSegments.map((segment) => segment.text)).toEqual(['We wait', 'now']);
    expect(splitSegments[0]?.endSeconds).toBeCloseTo(8.5);
    expect(splitSegments[1]?.startSeconds).toBeCloseTo(8.5);
    expect(splitSegments[0]?.wordTimings?.map((word) => word.text)).toEqual(['We', 'wait']);
    expect(splitSegments[1]?.wordTimings?.map((word) => word.text)).toEqual(['now']);
    db.close();
  });

  it('maps stored timestamp token suffixes back to transcript words during split', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 2,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 2,
      text: 'Take care',
      wordTimings: [
        { text: 'Take', startSeconds: 0.1, endSeconds: 0.5 },
        { text: 'careTT_906', startSeconds: 0.5, endSeconds: 1 }
      ],
      alignmentStatus: 'aligned',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const splitSegments = splitTranscriptSegment(db, created.job.id, 'seg_1', 4);

    expect(splitSegments.map((segment) => segment.text)).toEqual(['Take', 'care']);
    expect(splitSegments[0]?.wordTimings?.map((word) => word.text)).toEqual(['Take']);
    expect(splitSegments[1]?.wordTimings?.map((word) => word.text)).toEqual(['careTT_906']);
    expect(splitSegments[1]?.alignmentStatus).toBe('aligned');
    db.close();
  });

  it('partitions compact word timings when visible text contains a hyphenated compound', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 2,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 2,
      text: 'award-winning piano',
      wordTimings: [
        { text: 'awardwinning', startSeconds: 0.1, endSeconds: 1.4 },
        { text: 'piano', startSeconds: 1.5, endSeconds: 1.9 }
      ],
      alignmentStatus: 'aligned',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const splitSegments = splitTranscriptSegment(db, created.job.id, 'seg_1', 'award-winning'.length);

    expect(splitSegments.map((segment) => segment.text)).toEqual(['award-winning', 'piano']);
    expect(splitSegments[0]?.wordTimings?.map((word) => word.text)).toEqual(['awardwinning']);
    expect(splitSegments[1]?.wordTimings?.map((word) => word.text)).toEqual(['piano']);
    db.close();
  });

  it('marks word alignment stale after text rewrites and partial after timestamp narrowing', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 5,
      text: 'Hello world again',
      wordTimings: [
        { text: 'Hello', startSeconds: 0.2, endSeconds: 0.7 },
        { text: 'world', startSeconds: 1.1, endSeconds: 1.7 },
        { text: 'again', startSeconds: 2.2, endSeconds: 2.9 }
      ],
      alignmentStatus: 'aligned',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const narrowed = updateTranscriptSegmentTiming(db, created.job.id, 'seg_1', 1, 2);

    expect(narrowed.error).toBeNull();
    expect(narrowed.segments[0]?.alignmentStatus).toBe('partial');

    const edited = updateTranscriptSegmentText(db, created.job.id, 'seg_1', 'Completely different text.');

    expect(edited?.alignmentStatus).toBe('stale');
    expect(edited?.wordTimings?.map((word) => word.text)).toEqual(['Hello', 'world', 'again']);
    db.close();
  });

  it('merges adjacent transcript segments and closes the index gap', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 3,
      text: 'Hello',
      confidence: 0.8,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptSegment(db, {
      id: 'seg_2',
      jobId: created.job.id,
      index: 1,
      startSeconds: 3,
      endSeconds: 6,
      text: 'world',
      confidence: 1,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptSegment(db, {
      id: 'seg_3',
      jobId: created.job.id,
      index: 2,
      startSeconds: 6,
      endSeconds: 9,
      text: 'after',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const segments = mergeTranscriptSegment(db, created.job.id, 'seg_2', 'previous');

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.index)).toEqual([0, 1]);
    expect(segments[0]).toMatchObject({
      id: 'seg_1',
      startSeconds: 0,
      endSeconds: 6,
      text: 'Hello world',
      confidence: 0.9
    });
    expect(segments[1]?.id).toBe('seg_3');
    expect(segments[0]?.editedAt).toEqual(expect.any(String));
    db.close();
  });

  it('updates transcript segment timing and rejects overlaps', () => {
    const db = openVoxmireDatabase(':memory:');
    const created = createJobRecord(db, {
      modelId: 'large-v3-turbo',
      sourceFile: {
        id: 'src_1',
        path: 'C:/audio/example.wav',
        name: 'example.wav',
        extension: 'wav',
        sizeBytes: 100,
        durationSeconds: 10,
        createdAt: '2026-04-23T00:00:00.000Z'
      }
    });

    saveTranscriptSegment(db, {
      id: 'seg_1',
      jobId: created.job.id,
      index: 0,
      startSeconds: 0,
      endSeconds: 3,
      text: 'Before',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptSegment(db, {
      id: 'seg_2',
      jobId: created.job.id,
      index: 1,
      startSeconds: 3,
      endSeconds: 6,
      text: 'Middle',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });
    saveTranscriptSegment(db, {
      id: 'seg_3',
      jobId: created.job.id,
      index: 2,
      startSeconds: 6,
      endSeconds: 9,
      text: 'After',
      confidence: null,
      createdAt: '2026-04-23T00:00:00.000Z'
    });

    const updated = updateTranscriptSegmentTiming(db, created.job.id, 'seg_2', 3.25, 5.75);

    expect(updated.error).toBeNull();
    expect(updated.segments[1]).toMatchObject({
      startSeconds: 3.25,
      endSeconds: 5.75
    });
    expect(updated.segments[1]?.editedAt).toEqual(expect.any(String));

    const rejected = updateTranscriptSegmentTiming(db, created.job.id, 'seg_2', 2.5, 5.75);

    expect(rejected.error).toBe('Start time cannot overlap the previous segment.');
    expect(rejected.segments[1]?.startSeconds).toBe(3.25);
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
