import { describe, expect, it } from 'vitest';
import {
  assertJobStatusTransition,
  canTransitionJobStatus,
  estimateChunkCount,
  getTranscriptionPreset,
  mapTranscriptWordTimingsToTextRanges,
  resolveTranscriptionPreset,
  shouldChunkAudio,
  transcriptionPresets
} from './index';

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

describe('transcription presets', () => {
  it('defines the practical user-facing presets', () => {
    expect(transcriptionPresets.map((preset) => preset.id)).toEqual(['balanced', 'fast', 'quality', 'low-memory']);
    expect(transcriptionPresets.filter((preset) => preset.recommended)).toHaveLength(1);
  });

  it('maps presets to model and backend choices', () => {
    expect(resolveTranscriptionPreset('balanced', { machineProfile: { recommendedBackend: 'cuda' } })).toMatchObject({
      modelId: 'large-v3-turbo',
      engineBackend: 'cuda'
    });
    expect(resolveTranscriptionPreset('fast', { machineProfile: { recommendedBackend: 'vulkan' } })).toMatchObject({
      modelId: 'small-q8_0',
      engineBackend: 'vulkan'
    });
    expect(resolveTranscriptionPreset('quality')).toMatchObject({ modelId: 'large-v3', engineBackend: 'cpu' });
    expect(resolveTranscriptionPreset('low-memory', { machineProfile: { recommendedBackend: 'cuda' } })).toMatchObject({
      modelId: 'small-q8_0',
      engineBackend: 'cpu'
    });
  });

  it('returns preset metadata by id', () => {
    expect(getTranscriptionPreset('balanced').label).toBe('Balanced');
  });
});

describe('transcript word range mapping', () => {
  it('maps compact timing words to hyphenated visible text', () => {
    const text = 'The award-winning piano uses very high-quality hammers.';
    const ranges = mapTranscriptWordTimingsToTextRanges(text, [
      { text: 'The' },
      { text: 'awardwinning' },
      { text: 'piano' },
      { text: 'highquality' },
      { text: 'hammers' }
    ]);

    expect(ranges.map((range) => range ? text.slice(range.start, range.end) : null)).toEqual([
      'The',
      'award-winning',
      'piano',
      'high-quality',
      'hammers'
    ]);
  });

  it('maps hyphenated timing words to spaced visible text', () => {
    const text = 'Award winning results need careful review.';
    const ranges = mapTranscriptWordTimingsToTextRanges(text, [
      { text: 'award-winning' },
      { text: 'results' }
    ]);

    expect(ranges.map((range) => range ? text.slice(range.start, range.end) : null)).toEqual([
      'Award winning',
      'results'
    ]);
  });

  it('ignores timestamp token suffixes while preserving visible ranges', () => {
    const text = 'Take care.';
    const ranges = mapTranscriptWordTimingsToTextRanges(text, [
      { text: 'Take' },
      { text: 'careTT_906' }
    ]);

    expect(ranges.map((range) => range ? text.slice(range.start, range.end) : null)).toEqual(['Take', 'care']);
  });
});
