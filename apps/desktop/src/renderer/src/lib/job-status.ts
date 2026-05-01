import type { JobStatus } from '@voxmire/contracts';

export const activeStatuses: JobStatus[] = ['queued', 'preparing', 'transcribing'];

export function statusClass(status: JobStatus): string {
  if (status === 'completed') return 'ready';
  if (status === 'failed') return 'missing';
  if (status === 'canceled') return 'optional';
  if (activeStatuses.includes(status)) return 'active';
  return 'optional';
}

export function statusLabel(status: JobStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function progressPercent(progress: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

export function shouldShowTranscriptionProgress(status: JobStatus, progress: number): boolean {
  return status === 'transcribing' || (status === 'paused' && progress > 0);
}

export function jobProgressLabel(status: JobStatus, progress: number): string {
  if (status === 'queued') {
    return 'Queued';
  }

  if (status === 'preparing') {
    return 'Preparing audio...';
  }

  if (status === 'transcribing') {
    return `Transcribing / ${progressPercent(progress)}%`;
  }

  if (status === 'paused') {
    return progress > 0 ? `Paused / ${progressPercent(progress)}%` : 'Paused';
  }

  if (status === 'completed') {
    return 'Completed / 100%';
  }

  return statusLabel(status);
}
