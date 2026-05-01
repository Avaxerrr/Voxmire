import type { TranscriptSegment } from '@voxmire/contracts';

export type TranscriptFocusTarget = 'text' | 'start-time' | 'end-time';

export type TranscriptWorkspaceState = {
  focusTarget: TranscriptFocusTarget | null;
  jobId: string | null;
  scrollTop: number;
  segmentId: TranscriptSegment['id'] | null;
};

export const emptyTranscriptWorkspaceState: TranscriptWorkspaceState = {
  focusTarget: null,
  jobId: null,
  scrollTop: 0,
  segmentId: null
};