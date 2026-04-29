import { mapTranscriptWordTimingsToTextRanges } from '@voxmire/core';
import type { TranscriptSegment } from '@voxmire/contracts';
import type { TextRange } from '../../lib/transcript-search';

const wordTimingBoundaryToleranceSeconds = 0.025;

export type PlaybackWordState = {
  alignmentStatus: TranscriptSegment['alignmentStatus'] | 'none';
  nextWord: WordTimingSnapshot | null;
  previousWord: WordTimingSnapshot | null;
  range: TextRange | null;
  reason:
    | 'active'
    | 'between-words'
    | 'invalid-time'
    | 'missing-word-timings'
    | 'outside-segment-window'
    | 'recently-ended'
    | 'text-range-missing'
    | 'unusable-alignment';
  segmentEndSeconds: number;
  segmentStartSeconds: number;
  wordCount: number;
  wordEndSeconds: number | null;
  wordIndex: number;
  wordStartSeconds: number | null;
  wordText: string | null;
};

export type WordTimingSnapshot = {
  endSeconds: number;
  index: number;
  startSeconds: number;
  text: string;
};

export function getPlaybackWordState(segment: TranscriptSegment, playbackTime: number): PlaybackWordState {
  const wordTimings = segment.wordTimings ?? [];
  const alignmentStatus = segment.alignmentStatus ?? (wordTimings.length > 0 ? 'aligned' : 'none');
  const baseState: Omit<PlaybackWordState, 'nextWord' | 'previousWord' | 'range' | 'reason' | 'wordEndSeconds' | 'wordIndex' | 'wordStartSeconds' | 'wordText'> = {
    alignmentStatus,
    segmentEndSeconds: segment.endSeconds,
    segmentStartSeconds: segment.startSeconds,
    wordCount: wordTimings.length
  };

  if (!Number.isFinite(playbackTime)) {
    return playbackWordState(baseState, 'invalid-time');
  }

  if (!wordTimings.length) {
    return playbackWordState(baseState, 'missing-word-timings');
  }

  if (!wordAlignmentUsable(segment)) {
    return playbackWordState(baseState, 'unusable-alignment');
  }

  if (
    playbackTime < segment.startSeconds - wordTimingBoundaryToleranceSeconds ||
    playbackTime > segment.endSeconds + wordTimingBoundaryToleranceSeconds
  ) {
    return playbackWordState(baseState, 'outside-segment-window');
  }

  const ranges = mapTranscriptWordTimingsToTextRanges(segment.text, wordTimings);
  let activeWordIndex = -1;
  let previousWordIndex = -1;
  let nextWordIndex = -1;

  for (let index = 0; index < wordTimings.length; index += 1) {
    const word = wordTimings[index];
    if (!word || !wordTimingWithinSegment(word, segment)) {
      continue;
    }

    if (
      word.startSeconds <= playbackTime &&
      playbackTime < word.endSeconds + wordTimingBoundaryToleranceSeconds
    ) {
      activeWordIndex = index;
      break;
    }

    if (word.endSeconds <= playbackTime) {
      previousWordIndex = index;
    } else if (nextWordIndex < 0 && word.startSeconds > playbackTime) {
      nextWordIndex = index;
    }
  }

  if (activeWordIndex >= 0) {
    const range = ranges[activeWordIndex] ?? null;
    return playbackWordState(
      baseState,
      range ? 'active' : 'text-range-missing',
      wordTimingSnapshot(wordTimings, activeWordIndex),
      range,
      wordTimingSnapshot(wordTimings, previousWordIndex),
      wordTimingSnapshot(wordTimings, nextWordIndex)
    );
  }

  const previousWord = wordTimingSnapshot(wordTimings, previousWordIndex);
  const nextWord = wordTimingSnapshot(wordTimings, nextWordIndex);
  return playbackWordState(baseState, 'between-words', null, null, previousWord, nextWord);
}

function playbackWordState(
  baseState: Omit<PlaybackWordState, 'nextWord' | 'previousWord' | 'range' | 'reason' | 'wordEndSeconds' | 'wordIndex' | 'wordStartSeconds' | 'wordText'>,
  reason: PlaybackWordState['reason'],
  word: WordTimingSnapshot | null = null,
  range: TextRange | null = null,
  previousWord: WordTimingSnapshot | null = null,
  nextWord: WordTimingSnapshot | null = null
): PlaybackWordState {
  return {
    ...baseState,
    nextWord,
    previousWord,
    range,
    reason,
    wordEndSeconds: word?.endSeconds ?? null,
    wordIndex: word?.index ?? -1,
    wordStartSeconds: word?.startSeconds ?? null,
    wordText: word?.text ?? null
  };
}

function wordAlignmentUsable(segment: TranscriptSegment): boolean {
  const status = segment.alignmentStatus ?? (segment.wordTimings && segment.wordTimings.length > 0 ? 'aligned' : 'none');
  return (
    (status === 'aligned' || status === 'partial') &&
    Array.isArray(segment.wordTimings) &&
    segment.wordTimings.length > 0
  );
}

function wordTimingWithinSegment(word: NonNullable<TranscriptSegment['wordTimings']>[number], segment: TranscriptSegment): boolean {
  return (
    word.startSeconds >= segment.startSeconds - wordTimingBoundaryToleranceSeconds &&
    word.endSeconds <= segment.endSeconds + wordTimingBoundaryToleranceSeconds
  );
}

function wordTimingSnapshot(wordTimings: NonNullable<TranscriptSegment['wordTimings']>, index: number): WordTimingSnapshot | null {
  const word = wordTimings[index];
  if (!word) {
    return null;
  }

  return {
    endSeconds: word.endSeconds,
    index,
    startSeconds: word.startSeconds,
    text: word.text
  };
}
