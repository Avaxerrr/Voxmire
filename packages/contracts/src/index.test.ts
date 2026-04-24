import { describe, expect, it } from 'vitest';
import { transcriptionChunkSchema, transcriptSegmentSchema, transcriptionJobSchema } from './index';

describe('contracts', () => {
  it('validates transcription job payloads', () => {
    expect(() =>
      transcriptionJobSchema.parse({
        id: 'job_1',
        sourceFileId: 'src_1',
        status: 'queued',
        modelId: 'large-v3-turbo',
        engineBackend: 'cpu',
        progress: 0,
        errorMessage: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        completedAt: null
      })
    ).not.toThrow();
  });

  it('rejects invalid segment timing confidence', () => {
    expect(() =>
      transcriptSegmentSchema.parse({
        id: 'seg_1',
        jobId: 'job_1',
        index: 0,
        startSeconds: 0,
        endSeconds: 10,
        text: 'Hello',
        confidence: 2,
        createdAt: '2026-04-23T00:00:00.000Z'
      })
    ).toThrow();
  });

  it('validates transcription chunk payloads', () => {
    expect(() =>
      transcriptionChunkSchema.parse({
        id: 'chunk_1',
        jobId: 'job_1',
        index: 0,
        startSeconds: 0,
        endSeconds: 600,
        filePath: 'C:/audio/chunk-0000.wav',
        status: 'queued',
        errorMessage: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        completedAt: null
      })
    ).not.toThrow();
  });
});
