import type { JobStatus, ModelProfile } from '@voxmire/contracts';

export const defaultChunkPolicy = {
  targetSeconds: 600,
  overlapSeconds: 5,
  maxSecondsBeforeChunking: 1800
} as const;

export const modelProfiles: readonly ModelProfile[] = [
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    purpose: 'Default',
    description: 'Balanced quality and speed for most machines.',
    recommended: true,
    languages: 'multilingual',
    relativeSpeed: 'balanced',
    relativeQuality: 'better'
  },
  {
    id: 'large-v3',
    label: 'Large v3',
    purpose: 'Quality',
    description: 'Best quality mode when time and memory allow.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'slow',
    relativeQuality: 'best'
  },
  {
    id: 'distil-large-v3.5',
    label: 'Distil Large v3.5',
    purpose: 'Fast English',
    description: 'Fast option for English-heavy recordings.',
    recommended: false,
    languages: 'english-focused',
    relativeSpeed: 'fast',
    relativeQuality: 'better'
  },
  {
    id: 'medium',
    label: 'Medium',
    purpose: 'Fallback',
    description: 'Lower memory option for older hardware.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  }
];

const allowedTransitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['preparing', 'canceled'],
  preparing: ['transcribing', 'failed', 'canceled'],
  transcribing: ['paused', 'completed', 'failed', 'canceled'],
  paused: ['transcribing', 'canceled'],
  completed: [],
  failed: [],
  canceled: []
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertJobStatusTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new Error(`Invalid job status transition from ${from} to ${to}`);
  }
}

export function shouldChunkAudio(durationSeconds: number | null): boolean {
  return durationSeconds !== null && durationSeconds > defaultChunkPolicy.maxSecondsBeforeChunking;
}

export function estimateChunkCount(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(durationSeconds / defaultChunkPolicy.targetSeconds));
}
