import { describe, expect, it } from 'vitest';
import { assertJobStatusTransition, canTransitionJobStatus, estimateChunkCount, shouldChunkAudio } from './index';

describe('job state transitions', () => {
  it('allows valid progressions', () => {
    expect(canTransitionJobStatus('queued', 'preparing')).toBe(true);
    expect(canTransitionJobStatus('transcribing', 'completed')).toBe(true);
  });

  it('rejects terminal status transitions', () => {
    expect(() => assertJobStatusTransition('completed', 'transcribing')).toThrow();
  });
});

describe('chunk policy', () => {
  it('chunks multi-hour audio', () => {
    expect(shouldChunkAudio(10_800)).toBe(true);
    expect(estimateChunkCount(10_800)).toBe(18);
  });
});
