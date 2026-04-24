import { describe, expect, it } from 'vitest';
import {
  assertJobStatusTransition,
  canTransitionJobStatus,
  estimateChunkCount,
  getTranscriptionPreset,
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
      modelId: 'distil-large-v3.5',
      engineBackend: 'vulkan'
    });
    expect(resolveTranscriptionPreset('quality')).toMatchObject({ modelId: 'large-v3', engineBackend: 'cpu' });
    expect(resolveTranscriptionPreset('low-memory', { machineProfile: { recommendedBackend: 'cuda' } })).toMatchObject({
      modelId: 'medium',
      engineBackend: 'cpu'
    });
  });

  it('returns preset metadata by id', () => {
    expect(getTranscriptionPreset('balanced').label).toBe('Balanced');
  });
});
