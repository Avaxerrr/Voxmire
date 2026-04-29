import { mapTranscriptWordTimingsToTextRanges } from '@voxmire/core';
import type { TranscriptAlignmentStatus, TranscriptSegment, TranscriptWordTiming } from '@voxmire/contracts';
import { defaultAlignmentStatus } from './rows';

const minimumSegmentDurationSeconds = 0.05;
const linkedTimingBoundaryToleranceSeconds = 0.05;

export function joinSegmentText(first: string, second: string): string {
  const left = first.trimEnd();
  const right = second.trimStart();
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left} ${right}`;
}

export function reconcileTextEditAlignment(
  current: TranscriptSegment,
  nextText: string
): { wordTimings: TranscriptWordTiming[] | undefined; alignmentStatus: TranscriptAlignmentStatus } {
  const wordTimings = current.wordTimings;
  if (!wordTimings || wordTimings.length === 0) {
    return { wordTimings: undefined, alignmentStatus: 'none' };
  }

  if (normalizeWords(current.text).join(' ') === normalizeWords(nextText).join(' ')) {
    return { wordTimings, alignmentStatus: current.alignmentStatus ?? 'aligned' };
  }

  return { wordTimings, alignmentStatus: 'stale' };
}

export function alignmentStatusForTiming(
  current: TranscriptSegment,
  startSeconds: number,
  endSeconds: number
): TranscriptAlignmentStatus {
  const wordTimings = current.wordTimings;
  if (!wordTimings || wordTimings.length === 0) {
    return 'none';
  }

  if (current.alignmentStatus === 'stale') {
    return 'stale';
  }

  const inRangeCount = wordTimings.filter((word) => word.startSeconds >= startSeconds && word.endSeconds <= endSeconds).length;
  if (inRangeCount === 0) {
    return 'stale';
  }

  if (inRangeCount < wordTimings.length) {
    return 'partial';
  }

  return current.alignmentStatus === 'partial' ? 'partial' : 'aligned';
}

export function splitSecondsForTextOffset(segment: TranscriptSegment, offset: number, fallbackSplitSeconds: number): number {
  const wordTimings = segment.wordTimings;
  if (!wordTimings || wordTimings.length === 0) {
    return fallbackSplitSeconds;
  }

  const ranges = mapTranscriptWordTimingsToTextRanges(segment.text, wordTimings);
  let previousWord: TranscriptWordTiming | null = null;
  let nextWord: TranscriptWordTiming | null = null;
  let splitInsideWordSeconds: number | null = null;

  for (let index = 0; index < wordTimings.length; index += 1) {
    const word = wordTimings[index];
    const range = ranges[index];
    if (!word || !range) {
      continue;
    }

    if (range.end <= offset) {
      previousWord = word;
      continue;
    }

    if (range.start >= offset) {
      nextWord = word;
      break;
    }

    if (range.start < offset && offset < range.end) {
      const wordTextRatio = (offset - range.start) / Math.max(1, range.end - range.start);
      splitInsideWordSeconds = word.startSeconds + (word.endSeconds - word.startSeconds) * wordTextRatio;
      break;
    }
  }

  if (splitInsideWordSeconds !== null) {
    return clampSegmentSplitSeconds(segment, splitInsideWordSeconds, fallbackSplitSeconds);
  }

  if (previousWord && nextWord) {
    return clampSegmentSplitSeconds(segment, Math.max(previousWord.endSeconds, nextWord.startSeconds), fallbackSplitSeconds);
  }

  if (nextWord) {
    return clampSegmentSplitSeconds(segment, nextWord.startSeconds, fallbackSplitSeconds);
  }

  if (previousWord) {
    return clampSegmentSplitSeconds(segment, previousWord.endSeconds, fallbackSplitSeconds);
  }

  return fallbackSplitSeconds;
}

export function partitionWordTimingsForSplit(
  segment: TranscriptSegment,
  offset: number,
  splitSeconds: number
): { left: TranscriptWordTiming[] | undefined; right: TranscriptWordTiming[] | undefined } {
  const wordTimings = segment.wordTimings;
  if (!wordTimings || wordTimings.length === 0) {
    return { left: undefined, right: undefined };
  }

  const ranges = mapTranscriptWordTimingsToTextRanges(segment.text, wordTimings);
  const left: TranscriptWordTiming[] = [];
  const right: TranscriptWordTiming[] = [];

  wordTimings.forEach((word, index) => {
    const range = ranges[index];
    const assignLeft = range
      ? range.start < offset && range.end <= offset
      : word.endSeconds <= splitSeconds;

    if (assignLeft) {
      left.push(word);
      return;
    }

    right.push(word);
  });

  return {
    left: left.length > 0 ? left : undefined,
    right: right.length > 0 ? right : undefined
  };
}

export function splitAlignmentStatus(
  currentStatus: TranscriptAlignmentStatus | undefined,
  wordTimings: TranscriptWordTiming[] | undefined
): TranscriptAlignmentStatus {
  if (!wordTimings || wordTimings.length === 0) {
    return 'none';
  }

  return currentStatus === 'stale' ? 'stale' : currentStatus === 'partial' ? 'partial' : 'aligned';
}

export function mergeWordTimings(first: TranscriptSegment, second: TranscriptSegment): TranscriptWordTiming[] | undefined {
  const merged = [...(first.wordTimings ?? []), ...(second.wordTimings ?? [])].sort(
    (left, right) => left.startSeconds - right.startSeconds
  );
  return merged.length > 0 ? merged : undefined;
}

export function mergeAlignmentStatus(
  first: TranscriptSegment,
  second: TranscriptSegment,
  mergedWordTimings: TranscriptWordTiming[] | undefined
): TranscriptAlignmentStatus {
  if (!mergedWordTimings || mergedWordTimings.length === 0) {
    return 'none';
  }

  const statuses = [first.alignmentStatus ?? defaultAlignmentStatus(first.wordTimings), second.alignmentStatus ?? defaultAlignmentStatus(second.wordTimings)];
  if (statuses.every((status) => status === 'aligned')) {
    return 'aligned';
  }

  if (statuses.every((status) => status === 'stale' || status === 'none')) {
    return 'stale';
  }

  return 'partial';
}

export function mergeConfidence(first: number | null, second: number | null): number | null {
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }
  return (first + second) / 2;
}

export function shouldLinkTimingBoundary(leftEndSeconds: number, rightStartSeconds: number): boolean {
  return Math.abs(leftEndSeconds - rightStartSeconds) <= linkedTimingBoundaryToleranceSeconds;
}

export function validateSegmentTiming(
  segments: TranscriptSegment[],
  currentIndex: number,
  startSeconds: number,
  endSeconds: number
): string | null {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return 'Timestamp must be a valid number.';
  }

  if (startSeconds < 0) {
    return 'Start time cannot be negative.';
  }

  if (endSeconds <= startSeconds) {
    return 'End time must be after start time.';
  }

  if (endSeconds - startSeconds < minimumSegmentDurationSeconds) {
    return 'Segment duration must be at least 0.05 seconds.';
  }

  const current = segments[currentIndex];
  const previous = segments[currentIndex - 1];
  const linkPreviousBoundary = Boolean(previous && current && shouldLinkTimingBoundary(previous.endSeconds, current.startSeconds));
  if (previous) {
    if (linkPreviousBoundary) {
      if (startSeconds - previous.startSeconds < minimumSegmentDurationSeconds) {
        return 'Start time would make the previous segment shorter than 0.05 seconds.';
      }
    } else if (startSeconds < previous.endSeconds) {
      return 'Start time cannot overlap the previous segment.';
    }
  }

  const next = segments[currentIndex + 1];
  const linkNextBoundary = Boolean(next && current && shouldLinkTimingBoundary(current.endSeconds, next.startSeconds));
  if (next) {
    if (linkNextBoundary) {
      if (next.endSeconds - endSeconds < minimumSegmentDurationSeconds) {
        return 'End time would make the next segment shorter than 0.05 seconds.';
      }
    } else if (endSeconds > next.startSeconds) {
      return 'End time cannot overlap the next segment.';
    }
  }

  return null;
}

function clampSegmentSplitSeconds(segment: TranscriptSegment, splitSeconds: number, fallbackSplitSeconds: number): number {
  if (!Number.isFinite(splitSeconds)) {
    return fallbackSplitSeconds;
  }

  const minimum = segment.startSeconds + 0.001;
  const maximum = segment.endSeconds - 0.001;
  if (maximum <= minimum) {
    return fallbackSplitSeconds;
  }

  return Math.min(maximum, Math.max(minimum, splitSeconds));
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[\p{L}\p{N}']+/gu) ?? [];
}
