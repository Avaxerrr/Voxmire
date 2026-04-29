import type { EngineBackend } from '@voxmire/contracts';
import { WhisperCppEngine, detectWhisperEngine, type ResourcePaths } from '@voxmire/engine';
import { updateJobEngineBackend, type VoxmireDatabase } from '@voxmire/storage';
import type { VoxmireRuntimeLogInput } from './types';

type CreateWhisperEngineOptions = {
  db: VoxmireDatabase;
  resources: ResourcePaths;
  requestedBackend: EngineBackend;
  jobId: string;
  log: (event: VoxmireRuntimeLogInput) => void;
};

export function createWhisperEngine(options: CreateWhisperEngineOptions): WhisperCppEngine {
  const requested = detectWhisperEngine(options.resources, options.requestedBackend);
  if (requested.available) {
    return new WhisperCppEngine(options.resources, options.requestedBackend);
  }

  if (options.requestedBackend !== 'cpu') {
    const fallback = detectWhisperEngine(options.resources, 'cpu');
    if (fallback.available) {
      updateJobEngineBackend(options.db, options.jobId, 'cpu');
      options.log({
        level: 'warn',
        event: 'engine.fallback',
        jobId: options.jobId,
        chunkId: null,
        message: `Requested ${options.requestedBackend.toUpperCase()} backend is unavailable. Falling back to CPU.`,
        details: { requestedBackend: options.requestedBackend, reason: requested.reason }
      });
      return new WhisperCppEngine(options.resources, 'cpu');
    }
  }

  return new WhisperCppEngine(options.resources, options.requestedBackend);
}