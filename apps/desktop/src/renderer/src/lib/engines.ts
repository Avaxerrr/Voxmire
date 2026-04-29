import type { EngineBackend, EngineRuntimeId, JobWithSource, TranscriptionProgressEvent } from '@voxmire/contracts';

export type SolverLabelsByJobId = Record<string, string>;

export function engineRuntimeLabel(runtimeId: EngineRuntimeId): string {
  if (runtimeId === 'cuda-12.4') {
    return 'CUDA 12.4';
  }

  if (runtimeId === 'vulkan') {
    return 'Vulkan';
  }

  if (runtimeId === 'cpu-blas') {
    return 'BLAS CPU';
  }

  return 'CPU';
}

export function progressEventSolverLabel(event: TranscriptionProgressEvent): string | null {
  if (event.engineRuntimeId) {
    return engineRuntimeLabel(event.engineRuntimeId);
  }

  return event.engineLabel ? compactEngineLabel(event.engineLabel) : null;
}

export function solverLabelForJob(job: JobWithSource, observedSolverLabel: string | undefined): string {
  return observedSolverLabel ?? backendLabel(job.job.engineBackend);
}

function backendLabel(backend: EngineBackend): string {
  if (backend === 'cuda') {
    return 'CUDA';
  }

  if (backend === 'vulkan') {
    return 'Vulkan';
  }

  return 'CPU';
}

function compactEngineLabel(label: string): string {
  return label.replace(/^whisper\.cpp\s+/i, '').trim();
}
