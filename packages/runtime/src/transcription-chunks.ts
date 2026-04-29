import type { JobWithSource, TranscriptionChunk, TranscriptSegment } from '@voxmire/contracts';
import { defaultChunkPolicy } from '@voxmire/core';
import { prepareAudioChunks, type ResourcePaths } from '@voxmire/engine';
import { createId, getTranscriptionChunks, saveTranscriptionChunk, type VoxmireDatabase } from '@voxmire/storage';

export async function prepareJobChunks(
  db: VoxmireDatabase,
  resources: ResourcePaths,
  jobWithSource: JobWithSource,
  preparedDirectory: string,
  signal: AbortSignal
): Promise<TranscriptionChunk[]> {
  const existingChunks = getTranscriptionChunks(db, jobWithSource.job.id);
  if (existingChunks.length > 0) {
    return existingChunks;
  }

  const preparedChunks = await prepareAudioChunks(resources, {
    sourcePath: jobWithSource.sourceFile.path,
    jobId: jobWithSource.job.id,
    outputDirectory: preparedDirectory,
    durationSeconds: jobWithSource.sourceFile.durationSeconds,
    targetChunkSeconds: defaultChunkPolicy.targetSeconds,
    overlapSeconds: defaultChunkPolicy.overlapSeconds,
    maxSecondsBeforeChunking: defaultChunkPolicy.maxSecondsBeforeChunking,
    signal
  });

  const now = new Date().toISOString();
  return preparedChunks.map((chunk) =>
    saveTranscriptionChunk(db, {
      id: createId('chunk'),
      jobId: jobWithSource.job.id,
      index: chunk.index,
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      filePath: chunk.filePath,
      status: 'queued',
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    })
  );
}

export function calculateChunkedProgress(chunkIndex: number, chunkCount: number, chunkProgress: number): number {
  const safeChunkCount = Math.max(1, chunkCount);
  const transcribeProgress = (chunkIndex + Math.max(0, Math.min(1, chunkProgress))) / safeChunkCount;
  return Math.max(0.1, Math.min(0.99, 0.1 + transcribeProgress * 0.89));
}

export function offsetSegment(segment: TranscriptSegment, chunk: TranscriptionChunk, index: number): TranscriptSegment {
  return {
    ...segment,
    id: createId('seg'),
    index,
    startSeconds: chunk.startSeconds + segment.startSeconds,
    endSeconds: chunk.startSeconds + segment.endSeconds,
    wordTimings: segment.wordTimings?.map((word) => ({
      ...word,
      startSeconds: chunk.startSeconds + word.startSeconds,
      endSeconds: chunk.startSeconds + word.endSeconds
    }))
  };
}