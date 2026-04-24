import type {
  EngineBackend,
  JobStatus,
  MachineProfile,
  ModelId,
  ModelProfile,
  TranscriptionPresetId,
  TranscriptionPresetProfile
} from '@voxmire/contracts';

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

export const transcriptionPresets: readonly TranscriptionPresetProfile[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    purpose: 'Default',
    description: 'Balanced speed and quality for most recordings and machines.',
    recommended: true,
    modelId: 'large-v3-turbo',
    backendPreference: 'auto'
  },
  {
    id: 'fast',
    label: 'Fast',
    purpose: 'Speed',
    description: 'Faster turnaround for English-heavy recordings with practical quality.',
    recommended: false,
    modelId: 'distil-large-v3.5',
    backendPreference: 'auto'
  },
  {
    id: 'quality',
    label: 'Quality',
    purpose: 'Accuracy',
    description: 'Highest quality local preset when time and memory allow.',
    recommended: false,
    modelId: 'large-v3',
    backendPreference: 'auto'
  },
  {
    id: 'low-memory',
    label: 'Low memory',
    purpose: 'Compatibility',
    description: 'Lower memory CPU preset for older or resource-constrained machines.',
    recommended: false,
    modelId: 'medium',
    backendPreference: 'cpu'
  }
];

export type ResolveTranscriptionPresetOptions = {
  machineProfile?: Pick<MachineProfile, 'recommendedBackend'>;
  fallbackBackend?: EngineBackend;
};

export type ResolvedTranscriptionPreset = {
  preset: TranscriptionPresetProfile;
  modelId: ModelId;
  engineBackend: EngineBackend;
};

export function getTranscriptionPreset(presetId: TranscriptionPresetId): TranscriptionPresetProfile {
  const preset = transcriptionPresets.find((candidate) => candidate.id === presetId);
  if (!preset) {
    throw new Error(`Unknown transcription preset: ${presetId}`);
  }

  return preset;
}

export function resolveTranscriptionPreset(
  presetId: TranscriptionPresetId,
  options: ResolveTranscriptionPresetOptions = {}
): ResolvedTranscriptionPreset {
  const preset = getTranscriptionPreset(presetId);
  return {
    preset,
    modelId: preset.modelId,
    engineBackend: resolvePresetBackend(preset, options)
  };
}

function resolvePresetBackend(
  preset: TranscriptionPresetProfile,
  options: ResolveTranscriptionPresetOptions
): EngineBackend {
  if (preset.backendPreference === 'cpu') {
    return 'cpu';
  }

  return options.machineProfile?.recommendedBackend ?? options.fallbackBackend ?? 'cpu';
}

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
