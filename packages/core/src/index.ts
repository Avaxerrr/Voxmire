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
    id: 'small-q8_0',
    label: 'Small q8_0',
    purpose: 'Starter',
    description: 'Bundled starter model for first-run transcription with a smaller app footprint.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  },
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    purpose: 'Recommended',
    description: 'Best balance of quality, speed, and size for long local transcription.',
    recommended: true,
    languages: 'multilingual',
    relativeSpeed: 'balanced',
    relativeQuality: 'better'
  },
  {
    id: 'large-v3',
    label: 'Large v3',
    purpose: 'Quality',
    description: 'Highest quality option when download size, memory, and runtime are acceptable.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'slow',
    relativeQuality: 'best'
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
    label: 'Starter',
    purpose: 'Bundled',
    description: 'Bundled starter model for smaller installs and quick first-run transcription.',
    recommended: false,
    modelId: 'small-q8_0',
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
    description: 'CPU-only starter model for older or resource-constrained machines.',
    recommended: false,
    modelId: 'small-q8_0',
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

export type TranscriptTextRange = {
  start: number;
  end: number;
};

type WordTextLike = {
  text: string;
};

type FoldedText = {
  indexMap: TranscriptTextRange[];
  value: string;
};

export function mapTranscriptWordTimingsToTextRanges<TWord extends WordTextLike>(
  text: string,
  wordTimings: readonly TWord[]
): Array<TranscriptTextRange | null> {
  const foldedText = foldTextForWordRangeMatching(text);
  let foldedCursor = 0;

  return wordTimings.map((word) => {
    const searchText = foldWordTextForRangeMatching(word.text);
    if (!searchText) {
      return null;
    }

    const index = foldedText.value.indexOf(searchText, foldedCursor);
    if (index < 0) {
      return null;
    }

    const firstCharacter = foldedText.indexMap[index];
    const lastCharacter = foldedText.indexMap[index + searchText.length - 1];
    if (!firstCharacter || !lastCharacter) {
      return null;
    }

    foldedCursor = index + searchText.length;
    return { start: firstCharacter.start, end: lastCharacter.end };
  });
}

function foldWordTextForRangeMatching(value: string): string {
  return foldTextForWordRangeMatching(value.trim().replace(/TT_\d+$/i, '')).value;
}

function foldTextForWordRangeMatching(value: string): FoldedText {
  let folded = '';
  const indexMap: TranscriptTextRange[] = [];

  for (let index = 0; index < value.length;) {
    const character = value[index] ?? '';
    const codePoint = value.codePointAt(index);
    const source = codePoint === undefined ? character : String.fromCodePoint(codePoint);
    const nextIndex = index + source.length;

    if (/[\p{L}\p{N}]/u.test(source)) {
      const normalized = source.toLowerCase();
      for (let foldedIndex = 0; foldedIndex < normalized.length; foldedIndex += 1) {
        indexMap.push({ start: index, end: nextIndex });
      }
      folded += normalized;
    }

    index = nextIndex;
  }

  return { indexMap, value: folded };
}
