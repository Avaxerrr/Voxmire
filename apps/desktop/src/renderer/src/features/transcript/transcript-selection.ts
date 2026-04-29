import type { JobWithSource, TranscriptSegment } from '@voxmire/contracts';
import { formatDuration } from '../../lib/format';
import { activeStatuses, statusLabel } from '../../lib/job-status';
import { mediaKindLabel, type MediaKind } from '../../lib/media-kind';

const timestampSeekPreferenceToleranceSeconds = 0.05;

export type PreferredActiveSegment = {
  segmentId: string;
  timeSeconds: number;
};

export function preferredActiveSegmentIndexForPlayback(
  segments: TranscriptSegment[],
  playbackTime: number,
  preferredSegment: PreferredActiveSegment | null
): number {
  if (!preferredSegment || !Number.isFinite(playbackTime)) {
    return -1;
  }

  const index = segments.findIndex((segment) => segment.id === preferredSegment.segmentId);
  const segment = segments[index];
  if (!segment) {
    return -1;
  }

  const clickedTimeStillCurrent = Math.abs(playbackTime - preferredSegment.timeSeconds) <= timestampSeekPreferenceToleranceSeconds;
  const playbackTimeWithinSegment =
    playbackTime >= segment.startSeconds - timestampSeekPreferenceToleranceSeconds &&
    playbackTime <= segment.endSeconds + timestampSeekPreferenceToleranceSeconds;

  return clickedTimeStillCurrent && playbackTimeWithinSegment ? index : -1;
}

export function findActiveSegmentIndex(segments: TranscriptSegment[], time: number): number {
  if (segments.length === 0 || !Number.isFinite(time)) {
    return -1;
  }

  const firstSegment = segments[0];
  if (!firstSegment || time < firstSegment.startSeconds) {
    return -1;
  }

  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];

    if (!segment || segment.startSeconds > time) {
      high = middle - 1;
      continue;
    }

    candidate = middle;
    low = middle + 1;
  }

  return candidate;
}

export function transcriptSubtitle(job: JobWithSource, progress: number, mediaKind: MediaKind, solverLabel: string | null = null): string {
  if (activeStatuses.includes(job.job.status) || job.job.status === 'paused') {
    return `${statusLabel(job.job.status)} / ${progress}%${solverLabel ? ` / ${solverLabel}` : ''}`;
  }

  if (job.job.status === 'failed') {
    return 'Failed. Check the job error below.';
  }

  if (job.job.status === 'canceled') {
    return 'Canceled';
  }

  return `${formatDuration(job.sourceFile.durationSeconds)} ${mediaKindLabel(mediaKind)}`;
}
