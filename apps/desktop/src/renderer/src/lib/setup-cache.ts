import type { EngineBackend, ModelId } from '@voxmire/contracts';

const setupSummaryCacheKey = 'voxmire:setup-summary:v1';

export type CachedSetupSummary = {
  backend: EngineBackend;
  modelId: ModelId;
  modelLabel: string;
  updatedAt: string;
};

export function readCachedSetupSummary(): CachedSetupSummary | null {
  try {
    const rawValue = window.localStorage.getItem(setupSummaryCacheKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<CachedSetupSummary>;
    if (!isCachedSetupSummary(parsedValue)) {
      window.localStorage.removeItem(setupSummaryCacheKey);
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

export function writeCachedSetupSummary(summary: CachedSetupSummary): void {
  try {
    window.localStorage.setItem(setupSummaryCacheKey, JSON.stringify(summary));
  } catch {
    // The setup summary is a display cache only; failing to persist it should not affect transcription.
  }
}

function isCachedSetupSummary(value: Partial<CachedSetupSummary>): value is CachedSetupSummary {
  return typeof value.backend === 'string'
    && typeof value.modelId === 'string'
    && typeof value.modelLabel === 'string'
    && typeof value.updatedAt === 'string';
}
