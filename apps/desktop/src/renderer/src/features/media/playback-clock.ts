import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { type MediaKind } from '../../lib/media-kind';
import { applyMediaSeek } from './media-seek';
import { audioSeekThrottleMs, playbackSyncIntervalMs, videoSeekThrottleMs } from './playback-constants';

export type PlaybackClockSample = {
  mediaTime: number;
  playbackRate: number;
  readyState: number;
  sampleTimeMs: number;
  seeking: boolean;
  statePlaybackTime: number;
};

type UsePlaybackClockOptions = {
  audioRef: MutableRefObject<HTMLMediaElement | null>;
  canPlay: boolean;
  currentTime: number;
  diagnosticsEnabled: boolean;
  duration: number | null;
  externalSeekSignal: number;
  mediaKind: MediaKind;
  onClockSample: (sample: PlaybackClockSample | null) => void;
  onTimeChange: (time: number) => void;
  playing: boolean;
};

type PlaybackClockController = {
  clearDraftSeek: () => void;
  currentProgress: number;
  displayTime: number;
  draftSeekTime: number | null;
  recordSeekSample: (media: HTMLMediaElement, time: number) => void;
  resolvedDuration: number | null;
  seekTo: (seconds: number) => void;
  setVisualTime: (time: number) => void;
  startDraftSeek: () => void;
  syncPlaybackSample: (time: number, force?: boolean) => void;
  previewSeek: (seconds: number) => void;
};

function createPlaybackClockSample(media: HTMLMediaElement, mediaTime: number, statePlaybackTime: number, sampleTimeMs: number): PlaybackClockSample {
  return {
    mediaTime,
    playbackRate: media.playbackRate,
    readyState: media.readyState,
    sampleTimeMs,
    seeking: media.seeking,
    statePlaybackTime
  };
}

export function usePlaybackClock({
  audioRef,
  canPlay,
  currentTime,
  diagnosticsEnabled,
  duration,
  externalSeekSignal,
  mediaKind,
  onClockSample,
  onTimeChange,
  playing
}: UsePlaybackClockOptions): PlaybackClockController {
  const [visualTime, setVisualTime] = useState(currentTime);
  const [draftSeekTime, setDraftSeekTime] = useState<number | null>(null);
  const lastPlaybackSyncRef = useRef(0);
  const lastPreviewSeekRef = useRef(0);
  const syncedPlaybackTimeRef = useRef(currentTime);
  const resolvedDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
  const mediaTime = resolvedDuration ? Math.min(visualTime, resolvedDuration) : visualTime;
  const displayTime = draftSeekTime ?? mediaTime;
  const currentProgress = resolvedDuration ? Math.min(1, Math.max(0, displayTime / resolvedDuration)) : 0;

  useEffect(() => {
    syncedPlaybackTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const externalJumpThresholdSeconds = 0.3;
    if (draftSeekTime === null && (!playing || Math.abs(currentTime - visualTime) > externalJumpThresholdSeconds)) {
      setVisualTime(currentTime);
    }
  }, [currentTime, draftSeekTime, playing, visualTime]);

  useEffect(() => {
    if (draftSeekTime === null) {
      setVisualTime(currentTime);
    }
  }, [currentTime, draftSeekTime, externalSeekSignal]);

  useEffect(() => {
    if (!playing || !canPlay) {
      return;
    }

    let animationFrame = 0;
    let lastUpdate = 0;

    const updateVisualTime = (timestamp: number): void => {
      const audio = audioRef.current;
      if (audio && draftSeekTime === null && timestamp - lastUpdate >= 33) {
        const nextTime = audio.currentTime;
        setVisualTime(nextTime);
        if (diagnosticsEnabled) {
          onClockSample(createPlaybackClockSample(audio, nextTime, syncedPlaybackTimeRef.current, timestamp));
        }
        syncPlaybackSample(nextTime);
        lastUpdate = timestamp;
      }
      animationFrame = window.requestAnimationFrame(updateVisualTime);
    };

    animationFrame = window.requestAnimationFrame(updateVisualTime);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [audioRef, canPlay, diagnosticsEnabled, draftSeekTime, onClockSample, onTimeChange, playing]);

  function syncPlaybackSample(time: number, force = false): void {
    const now = performance.now();
    if (!force && now - lastPlaybackSyncRef.current < playbackSyncIntervalMs) {
      return;
    }

    lastPlaybackSyncRef.current = now;
    onTimeChange(time);
  }

  function recordSeekSample(media: HTMLMediaElement, time: number): void {
    if (diagnosticsEnabled) {
      onClockSample(createPlaybackClockSample(media, time, syncedPlaybackTimeRef.current, performance.now()));
    }
  }

  function previewSeek(seconds: number): void {
    if (!resolvedDuration) {
      return;
    }

    const audio = audioRef.current;
    const nextTime = Math.min(resolvedDuration, Math.max(0, seconds));
    setDraftSeekTime(nextTime);
    setVisualTime(nextTime);
    if (audio) {
      recordSeekSample(audio, nextTime);
    }
    syncPlaybackSample(nextTime, true);

    if (!audio || !canPlay) {
      return;
    }

    const now = performance.now();
    const seekThrottle = mediaKind === 'video' ? videoSeekThrottleMs : audioSeekThrottleMs;
    if (now - lastPreviewSeekRef.current < seekThrottle) {
      return;
    }

    applyMediaSeek(audio, nextTime, mediaKind === 'video');
    lastPreviewSeekRef.current = now;
  }

  function seekTo(seconds: number): void {
    const audio = audioRef.current;
    if (!audio || !canPlay || !resolvedDuration) {
      setDraftSeekTime(null);
      return;
    }

    const nextTime = Math.min(resolvedDuration, Math.max(0, seconds));
    applyMediaSeek(audio, nextTime, false);
    setDraftSeekTime(null);
    setVisualTime(nextTime);
    recordSeekSample(audio, nextTime);
    syncPlaybackSample(nextTime, true);
  }

  return {
    clearDraftSeek: () => setDraftSeekTime(null),
    currentProgress,
    displayTime,
    draftSeekTime,
    recordSeekSample,
    resolvedDuration,
    seekTo,
    setVisualTime,
    startDraftSeek: () => setDraftSeekTime(displayTime),
    syncPlaybackSample,
    previewSeek
  };
}
