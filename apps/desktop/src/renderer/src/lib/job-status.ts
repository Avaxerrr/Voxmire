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
