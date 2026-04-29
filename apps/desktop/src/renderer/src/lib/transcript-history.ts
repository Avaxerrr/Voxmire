import type { TranscriptSegment } from '@voxmire/contracts';

export type TranscriptHistoryEntry = {
  after: TranscriptSegment[];
  before: TranscriptSegment[];
  label: string;
};

export function replaceSegmentInTranscriptSnapshot(segments: TranscriptSegment[], updatedSegment: TranscriptSegment): TranscriptSegment[] {
  return segments.map((segment) => segment.id === updatedSegment.id ? updatedSegment : segment);
}

export function transcriptSegmentsEqual(left: TranscriptSegment[], right: TranscriptSegment[]): boolean {
  return left.length === right.length && left.every((segment, index) => transcriptSegmentEqual(segment, right[index]));
}

function transcriptSegmentEqual(left: TranscriptSegment, right: TranscriptSegment | undefined): boolean {
  if (!right) {
    return false;
  }

  return left.id === right.id
    && left.jobId === right.jobId
    && left.index === right.index
    && left.startSeconds === right.startSeconds
    && left.endSeconds === right.endSeconds
    && left.text === right.text
    && (left.originalText ?? null) === (right.originalText ?? null)
    && (left.alignmentStatus ?? null) === (right.alignmentStatus ?? null)
    && left.confidence === right.confidence
    && left.createdAt === right.createdAt
    && (left.editedAt ?? null) === (right.editedAt ?? null)
    && transcriptWordTimingsEqual(left.wordTimings, right.wordTimings);
}

function transcriptWordTimingsEqual(
  left: TranscriptSegment['wordTimings'],
  right: TranscriptSegment['wordTimings']
): boolean {
  const leftWords = left ?? [];
  const rightWords = right ?? [];
  return leftWords.length === rightWords.length && leftWords.every((word, index) => {
    const rightWord = rightWords[index];
    if (!rightWord) {
      return false;
    }

    return word.text === rightWord.text
      && word.startSeconds === rightWord.startSeconds
      && word.endSeconds === rightWord.endSeconds;
  });
}
