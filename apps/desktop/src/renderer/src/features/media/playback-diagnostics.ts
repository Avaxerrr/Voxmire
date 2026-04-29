import { useEffect, useState } from 'react';
import type { TranscriptSegment } from '@voxmire/contracts';
import { findActiveSegmentIndex } from '../transcript/transcript-selection';
import { getPlaybackWordState, type PlaybackWordState } from '../transcript/word-timing';
import { type PlaybackClockSample } from './playback-controls';
import { playbackSyncIntervalMs } from './playback-constants';

const playbackDiagnosticClockDriftWarningSeconds = 0.08;
const playbackDiagnosticLongGapWarningSeconds = 0.12;
const playbackTraceLimit = 600;

type WordTimingDiagnosticDetails = {
  activeSegmentIndex: number;
  playbackTime: number;
  segment: TranscriptSegment | undefined;
  wordState: PlaybackWordState | null;
};

export type PlaybackTimingDiagnostic = {
  activeSegmentIndex: number;
  anomaly: string | null;
  gapSeconds: number | null;
  mediaClockDriftSeconds: number | null;
  mediaSegmentIndex: number;
  mediaTime: number | null;
  playbackTime: number;
  reason: PlaybackWordState['reason'] | 'no-segment';
  segmentEndSeconds: number | null;
  segmentId: string | null;
  segmentStartSeconds: number | null;
  stateSegmentOffsetSeconds: number | null;
  wordDurationSeconds: number | null;
  wordEndSeconds: number | null;
  wordIndex: number;
  wordStartSeconds: number | null;
  wordText: string | null;
};

export function usePlaybackDiagnosticsEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => playbackDiagnosticsEnabled());

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const sync = (): void => setEnabled(playbackDiagnosticsEnabled());
    window.addEventListener('voxmire:playbackDiagnosticsChanged', sync);
    const intervalId = window.setInterval(sync, 1000);

    return () => {
      window.removeEventListener('voxmire:playbackDiagnosticsChanged', sync);
      window.clearInterval(intervalId);
    };
  }, []);

  return enabled;
}

export function buildPlaybackTimingDiagnostic({
  activeSegmentIndex,
  playbackClockSample,
  playbackTime,
  segments
}: {
  activeSegmentIndex: number;
  playbackClockSample: PlaybackClockSample | null;
  playbackTime: number;
  segments: TranscriptSegment[];
}): PlaybackTimingDiagnostic {
  const segment = segments[activeSegmentIndex];
  const wordState = segment ? getPlaybackWordState(segment, playbackTime) : null;
  const mediaTime = playbackClockSample?.mediaTime ?? null;
  const mediaSegmentIndex = mediaTime === null ? -1 : findActiveSegmentIndex(segments, mediaTime);
  const gapSeconds = wordState?.previousWord && wordState.nextWord ? wordState.nextWord.startSeconds - wordState.previousWord.endSeconds : null;
  const wordDurationSeconds = wordState && wordState.wordStartSeconds !== null && wordState.wordEndSeconds !== null
    ? wordState.wordEndSeconds - wordState.wordStartSeconds
    : null;
  const mediaClockDriftSeconds = mediaTime === null ? null : mediaTime - playbackTime;
  const diagnostic: PlaybackTimingDiagnostic = {
    activeSegmentIndex,
    anomaly: null,
    gapSeconds,
    mediaClockDriftSeconds,
    mediaSegmentIndex,
    mediaTime,
    playbackTime,
    reason: wordState?.reason ?? 'no-segment',
    segmentEndSeconds: segment?.endSeconds ?? null,
    segmentId: segment?.id ?? null,
    segmentStartSeconds: segment?.startSeconds ?? null,
    stateSegmentOffsetSeconds: segment ? playbackTime - segment.startSeconds : null,
    wordDurationSeconds,
    wordEndSeconds: wordState?.wordEndSeconds ?? null,
    wordIndex: wordState?.wordIndex ?? -1,
    wordStartSeconds: wordState?.wordStartSeconds ?? null,
    wordText: wordState?.wordText ?? null
  };

  diagnostic.anomaly = playbackTimingDiagnosticAnomaly(diagnostic);
  return diagnostic;
}

let lastPlaybackDiagnosticConsoleKey = '';

export function recordPlaybackTimingDiagnostic(diagnostic: PlaybackTimingDiagnostic): void {
  if (!playbackDiagnosticsEnabled()) {
    return;
  }

  const trace = window.__VOXMIRE_PLAYBACK_TRACE__ ?? [];
  trace.push(diagnostic);
  if (trace.length > playbackTraceLimit) {
    trace.splice(0, trace.length - playbackTraceLimit);
  }
  window.__VOXMIRE_PLAYBACK_TRACE__ = trace;

  const consoleKey = [diagnostic.activeSegmentIndex, diagnostic.wordIndex, diagnostic.reason, diagnostic.anomaly].join(':');
  if (consoleKey !== lastPlaybackDiagnosticConsoleKey || diagnostic.anomaly) {
    console.debug('[voxmire:word-sync]', JSON.stringify(diagnostic));
    lastPlaybackDiagnosticConsoleKey = consoleKey;
  }
}

function playbackTimingDiagnosticAnomaly(diagnostic: PlaybackTimingDiagnostic): string | null {
  if (diagnostic.mediaClockDriftSeconds !== null && Math.abs(diagnostic.mediaClockDriftSeconds) > playbackDiagnosticClockDriftWarningSeconds) {
    return diagnostic.mediaClockDriftSeconds > 0 ? 'ui-clock-behind-media' : 'ui-clock-ahead-of-media';
  }

  if (diagnostic.mediaSegmentIndex >= 0 && diagnostic.activeSegmentIndex !== diagnostic.mediaSegmentIndex) {
    return 'segment-selection-mismatch';
  }

  if (diagnostic.reason === 'text-range-missing') {
    return 'word-text-range-missing';
  }

  if (diagnostic.reason === 'between-words' && diagnostic.gapSeconds !== null && diagnostic.gapSeconds > playbackDiagnosticLongGapWarningSeconds) {
    return 'word-timing-gap';
  }

  if (diagnostic.wordDurationSeconds !== null && diagnostic.wordDurationSeconds < playbackSyncIntervalMs / 1000) {
    return 'word-shorter-than-ui-sample';
  }

  return null;
}

function playbackDiagnosticsEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  try {
    return window.localStorage.getItem('voxmire:playbackDiagnostics') === '1';
  } catch {
    return false;
  }
}

export function logPlaybackDiagnostic(eventName: string, media: HTMLMediaElement): void {
  if (!playbackDiagnosticsEnabled()) {
    return;
  }

  console.debug('[voxmire:playback]', eventName, {
    currentTime: media.currentTime,
    networkState: media.networkState,
    readyState: media.readyState,
    seekable: timeRangesToTuples(media.seekable),
    seeking: media.seeking
  });
}

export function logWordTimingDiagnostic({
  activeSegmentIndex,
  playbackTime,
  segment,
  wordState
}: WordTimingDiagnosticDetails): void {
  if (!playbackDiagnosticsEnabled()) {
    return;
  }

  const details = {
    activeSegmentIndex,
    alignmentStatus: wordState?.alignmentStatus ?? null,
    nextWord: wordState?.nextWord ?? null,
    playbackTime,
    previousWord: wordState?.previousWord ?? null,
    range: wordState?.range ?? null,
    segmentEndSeconds: segment?.endSeconds ?? null,
    segmentId: segment?.id ?? null,
    segmentStartSeconds: segment?.startSeconds ?? null,
    wordCount: wordState?.wordCount ?? 0,
    wordEndSeconds: wordState?.wordEndSeconds ?? null,
    wordIndex: wordState?.wordIndex ?? -1,
    wordStartSeconds: wordState?.wordStartSeconds ?? null,
    wordText: wordState?.wordText ?? null
  };

  console.debug('[voxmire:word-timing]', wordState?.reason ?? 'no-playback-segment', JSON.stringify(details));
}

function timeRangesToTuples(ranges: TimeRanges): Array<[number, number]> {
  return Array.from({ length: ranges.length }, (_, index) => [ranges.start(index), ranges.end(index)]);
}
