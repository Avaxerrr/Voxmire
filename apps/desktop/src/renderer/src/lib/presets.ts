import { modelSupportsTranscriptionOutputMode, resolveTranscriptionPreset, transcriptionPresets, type ResolvedTranscriptionPreset } from '@voxmire/core';
import type {
  EngineBackend,
  MachineProfile,
  ModelId,
  ModelProfile,
  ResourceStatus,
  TranscriptionOutputMode,
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
    id: 'small-q8_0',
    label: 'Small q8_0',
    purpose: 'starter',
    description: 'Bundled starter model for first-run transcription.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'fast',
    relativeQuality: 'good'
  },
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    purpose: 'recommended',
    description: 'Recommended default for long recordings with a practical speed and quality balance.',
    recommended: true,
    languages: 'multilingual',
    relativeSpeed: 'balanced',
    relativeQuality: 'better'
  },
  {
    id: 'large-v3',
    label: 'Large v3',
    purpose: 'quality',
    description: 'Higher quality preset for jobs where accuracy matters more than speed.',
    recommended: false,
    languages: 'multilingual',
    relativeSpeed: 'slow',
    relativeQuality: 'best'
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

export function presetSupportsOutputMode(preset: TranscriptionPresetProfile, outputMode: TranscriptionOutputMode): boolean {
  return modelSupportsTranscriptionOutputMode(preset.modelId, outputMode);
}

export function presetUsable(resources: ResourceStatus[], preset: TranscriptionPresetProfile, outputMode: TranscriptionOutputMode = 'transcribe'): boolean {
  return modelInstalled(resources, preset.modelId) && presetSupportsOutputMode(preset, outputMode);
}

export function visiblePresetOptions(resources: ResourceStatus[], outputMode: TranscriptionOutputMode = 'transcribe'): readonly TranscriptionPresetProfile[] {
  const compatiblePresets = transcriptionPresets.filter((preset) => presetSupportsOutputMode(preset, outputMode));
  const installed = uniquePresetsByModelId(compatiblePresets.filter((preset) => presetUsable(resources, preset, outputMode)));
  if (installed.length > 0) {
    return installed;
  }

  const preferred = outputMode === 'translate'
    ? compatiblePresets.filter((preset) => preset.modelId === 'large-v3' || preset.modelId === 'small-q8_0')
    : compatiblePresets.filter((preset) => preset.recommended);

  return uniquePresetsByModelId(preferred.length > 0 ? preferred : compatiblePresets);
}

function uniquePresetsByModelId(presets: readonly TranscriptionPresetProfile[]): TranscriptionPresetProfile[] {
  const seen = new Set<ModelId>();
  return presets.filter((preset) => {
    if (seen.has(preset.modelId)) {
      return false;
    }

    seen.add(preset.modelId);
    return true;
  });
}

export function presetModelOptionLabel(models: ModelProfile[], preset: TranscriptionPresetProfile): string {
  return models.find((model) => model.id === preset.modelId)?.label
    ?? fallbackModels.find((model) => model.id === preset.modelId)?.label
    ?? preset.modelId;
}

export function selectUsablePreset(recommendedModelId: ModelId, resources: ResourceStatus[], outputMode: TranscriptionOutputMode = 'transcribe'): TranscriptionPresetId {
  const compatiblePresets = transcriptionPresets.filter((preset) => presetSupportsOutputMode(preset, outputMode));

  if (outputMode === 'translate') {
    const qualityPreset = compatiblePresets.find((preset) => preset.modelId === 'large-v3' && presetUsable(resources, preset, outputMode));
    if (qualityPreset) {
      return qualityPreset.id;
    }

    const starterPreset = compatiblePresets.find((preset) => preset.modelId === 'small-q8_0' && presetUsable(resources, preset, outputMode));
    if (starterPreset) {
      return starterPreset.id;
    }
  }

  const matchingRecommended = compatiblePresets.find((preset) => preset.modelId === recommendedModelId && presetUsable(resources, preset, outputMode));
  if (matchingRecommended) {
    return matchingRecommended.id;
  }

  const recommended = compatiblePresets.find((preset) => preset.recommended && presetUsable(resources, preset, outputMode));
  if (recommended) {
    return recommended.id;
  }

  return compatiblePresets.find((preset) => presetUsable(resources, preset, outputMode))?.id ?? (outputMode === 'translate' ? 'fast' : 'balanced');
}

export function resolvePresetSelection(
  presetId: TranscriptionPresetId,
  machineProfile: MachineProfile | null,
  resources: ResourceStatus[],
  outputMode: TranscriptionOutputMode = 'transcribe'
): ResolvedTranscriptionPreset {
  const requestedPreset = resolveTranscriptionPreset(presetId).preset;
  const compatiblePresetId = presetSupportsOutputMode(requestedPreset, outputMode)
    ? presetId
    : selectUsablePreset('large-v3', resources, outputMode);
  const fallbackRecommendedModelId: ModelId = outputMode === 'translate' ? 'large-v3' : 'large-v3-turbo';
  const fallbackPresetId = presetUsable(resources, resolveTranscriptionPreset(compatiblePresetId).preset, outputMode)
    ? compatiblePresetId
    : selectUsablePreset(fallbackRecommendedModelId, resources, outputMode);
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
