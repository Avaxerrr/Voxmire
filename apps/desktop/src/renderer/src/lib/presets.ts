import { resolveTranscriptionPreset, transcriptionPresets, type ResolvedTranscriptionPreset } from '@voxmire/core';
import type {
  EngineBackend,
  MachineProfile,
  ModelId,
  ModelProfile,
  ResourceStatus,
  TranscriptionPresetId,
  TranscriptionPresetProfile
} from '@voxmire/contracts';

export type { ResolvedTranscriptionPreset } from '@voxmire/core';

export type BackendOption = {
  available: boolean;
  backend: EngineBackend;
  label: string;
};

export type BackendPreference = 'auto' | EngineBackend;

export const fallbackModels: ModelProfile[] = [
  {
    id: 'large-v3-turbo',
    label: 'large-v3-turbo',
    purpose: 'default',
    description: 'Recommended default for long recordings with a practical speed and quality balance.',
    recommended: true,
    languages: 'multilingual',
    relativeSpeed: 'balanced',
    relativeQuality: 'better'
  },
  {
    id: 'large-v3',
    label: 'large-v3',
    purpose: 'quality',
    description: 'Higher quality preset for jobs where accuracy matters more than speed.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'slow',
    relativeQuality: 'best'
  },
  {
    id: 'distil-large-v3.5',
    label: 'distil-large-v3.5',
    purpose: 'fast English',
    description: 'Fast English-focused preset for shorter turnaround on compatible recordings.',
    recommended: false,
    languages: 'english-focused',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  },
  {
    id: 'medium',
    label: 'medium',
    purpose: 'fallback',
    description: 'Lower resource fallback for older machines.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  }
];

export function backendOptions(machineProfile: MachineProfile | null): BackendOption[] {
  if (!machineProfile) {
    return [{ available: true, backend: 'cpu', label: 'CPU' }];
  }

  return machineProfile.backends.map((backend) => ({
    available: backend.executableAvailable && backend.runtimeAvailable,
    backend: backend.backend,
    label: `${backend.backend.toUpperCase()}${backend.recommended ? ' recommended' : ''}`
  }));
}

export function modelResource(resources: ResourceStatus[], modelId: ModelId): ResourceStatus | null {
  return resources.find((resource) => resource.id === `model-${modelId}`) ?? null;
}

export function modelInstalled(resources: ResourceStatus[], modelId: ModelId): boolean {
  return modelResource(resources, modelId)?.available ?? false;
}

export function presetUsable(resources: ResourceStatus[], preset: TranscriptionPresetProfile): boolean {
  return modelInstalled(resources, preset.modelId);
}

export function visiblePresetOptions(resources: ResourceStatus[]): readonly TranscriptionPresetProfile[] {
  const installed = transcriptionPresets.filter((preset) => presetUsable(resources, preset));
  if (installed.length > 0) {
    return installed;
  }

  return transcriptionPresets.filter((preset) => preset.recommended);
}

export function presetModelOptionLabel(models: ModelProfile[], preset: TranscriptionPresetProfile): string {
  return models.find((model) => model.id === preset.modelId)?.label
    ?? fallbackModels.find((model) => model.id === preset.modelId)?.label
    ?? preset.modelId;
}

export function selectUsablePreset(recommendedModelId: ModelId, resources: ResourceStatus[]): TranscriptionPresetId {
  const matchingRecommended = transcriptionPresets.find((preset) => preset.modelId === recommendedModelId && presetUsable(resources, preset));
  if (matchingRecommended) {
    return matchingRecommended.id;
  }

  const recommended = transcriptionPresets.find((preset) => preset.recommended && presetUsable(resources, preset));
  if (recommended) {
    return recommended.id;
  }

  return transcriptionPresets.find((preset) => presetUsable(resources, preset))?.id ?? 'balanced';
}

export function resolvePresetSelection(
  presetId: TranscriptionPresetId,
  machineProfile: MachineProfile | null,
  resources: ResourceStatus[]
): ResolvedTranscriptionPreset {
  const fallbackPresetId = presetUsable(resources, resolveTranscriptionPreset(presetId).preset)
    ? presetId
    : selectUsablePreset('large-v3-turbo', resources);
  const fallbackBackend = machineProfile ? selectUsableBackend(machineProfile) : 'cpu';
  const resolved = resolveTranscriptionPreset(fallbackPresetId, {
    ...(machineProfile ? { machineProfile } : {}),
    fallbackBackend
  });
  const backend = backendOptions(machineProfile).find((option) => option.backend === resolved.engineBackend);

  return {
    ...resolved,
    engineBackend: backend?.available ? resolved.engineBackend : fallbackBackend
  };
}

export function selectUsableBackend(machineProfile: MachineProfile): EngineBackend {
  const recommended = machineProfile.backends.find((backend) => backend.backend === machineProfile.recommendedBackend);
  if (recommended?.executableAvailable && recommended.runtimeAvailable) {
    return recommended.backend;
  }

  return 'cpu';
}

export function resolveBackendPreference(
  preference: BackendPreference,
  resolvedBackend: EngineBackend,
  machineProfile: MachineProfile | null
): EngineBackend {
  if (preference === 'auto') {
    return resolvedBackend;
  }

  const selected = backendOptions(machineProfile).find((option) => option.backend === preference);
  return selected?.available ? preference : resolvedBackend;
}

export function modelLabel(models: ModelProfile[], modelId: ModelId): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}
