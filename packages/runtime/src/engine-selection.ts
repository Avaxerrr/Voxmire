import type { EngineBackend } from '@voxmire/contracts';
import {
  detectWhisperRuntime,
  type ResourcePaths,
  WhisperCppEngine,
  whisperRuntimeIdsForBackend
} from '@voxmire/engine';
import { updateJobEngineBackend, type VoxmireDatabase } from '@voxmire/storage';
import type { VoxmireRuntimeLogInput } from './types';

export type WhisperEngineCandidate = {
  engine: WhisperCppEngine;
  label: string;
};

type CreateWhisperEnginePlanOptions = {
  db: VoxmireDatabase;
  resources: ResourcePaths;
  requestedBackend: EngineBackend;
  jobId: string;
  log: (event: VoxmireRuntimeLogInput) => void;
};

export function createWhisperEnginePlan(options: CreateWhisperEnginePlanOptions): WhisperEngineCandidate[] {
  const runtimeIds = whisperRuntimeIdsForBackend(options.requestedBackend);
  const detections = runtimeIds.map((runtimeId) => detectWhisperRuntime(options.resources, runtimeId));
  const candidates = detections
    .filter((detection) => detection.available)
    .map((detection) => ({
      engine: new WhisperCppEngine(options.resources, detection.runtimeId),
      label: detection.label
    }));

  const first = candidates[0];
  if (!first) {
    options.log({
      level: 'error',
      event: 'engine.selection.empty',
      jobId: options.jobId,
      chunkId: null,
      message: 'No compatible local whisper.cpp engine runtime is available.',
      details: { requestedBackend: options.requestedBackend, reasons: detections.map((detection) => detection.reason) }
    });
    return candidates;
  }

  if (first.engine.backend !== options.requestedBackend) {
    updateJobEngineBackend(options.db, options.jobId, first.engine.backend);
    options.log({
      level: 'warn',
      event: 'engine.fallback',
      jobId: options.jobId,
      chunkId: null,
      message: `Requested ${options.requestedBackend.toUpperCase()} backend is unavailable. Falling back to ${first.label}.`,
      details: {
        requestedBackend: options.requestedBackend,
        selectedBackend: first.engine.backend,
        selectedRuntimeId: first.engine.runtimeId,
        reasons: detections.filter((detection) => !detection.available).map((detection) => detection.reason)
      }
    });
  }

  return candidates;
}

export function promoteFallbackEngine(options: {
  db: VoxmireDatabase;
  failed: WhisperEngineCandidate;
  next: WhisperEngineCandidate;
  jobId: string;
  chunkId: string;
  reason: string;
  log: (event: VoxmireRuntimeLogInput) => void;
}): void {
  if (options.failed.engine.backend !== options.next.engine.backend) {
    updateJobEngineBackend(options.db, options.jobId, options.next.engine.backend);
  }

  options.log({
    level: 'warn',
    event: 'engine.fallback',
    jobId: options.jobId,
    chunkId: options.chunkId,
    message: `${options.failed.label} failed before committing transcript text. Retrying with ${options.next.label}.`,
    details: {
      failedRuntimeId: options.failed.engine.runtimeId,
      nextRuntimeId: options.next.engine.runtimeId,
      reason: options.reason
    }
  });
}