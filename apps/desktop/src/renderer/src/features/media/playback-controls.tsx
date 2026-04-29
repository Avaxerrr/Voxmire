import { type MutableRefObject, type ReactElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX, Zap } from 'lucide-react';
import { formatPreciseDuration, formatPreciseTime } from '../../lib/format';
import { type MediaKind } from '../../lib/media-kind';
import { formatPlaybackSpeed, scaleWaveformPeak, waveformScaleDescription, waveformScaleLabel, waveformScaleModes, type WaveformScaleMode } from '../../lib/waveform';
import { applyMediaSeek } from './media-seek';
import { audioSeekThrottleMs, playbackSpeeds, playbackSyncIntervalMs, videoSeekThrottleMs } from './playback-constants';

const waveformBars = Array.from({ length: 104 }, (_, index) => {
  const wave = Math.abs(Math.sin(index * 0.44)) * 42;
  const chatter = (index * 19) % 31;
  const pause = index % 21 < 5 ? 13 : 0;
  return Math.max(12, Math.min(92, Math.round(18 + wave + chatter - pause)));
});

export type PlaybackClockSample = {
  mediaTime: number;
  playbackRate: number;
  readyState: number;
  sampleTimeMs: number;
  seeking: boolean;
  statePlaybackTime: number;
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

type WaveformGraphProps = {
  loading: boolean;
  peaks: number[];
  scaleMode: WaveformScaleMode;
};

const WaveformGraph = memo(function WaveformGraph({ loading, peaks, scaleMode }: WaveformGraphProps): ReactElement {
  const width = 1200;
  const height = 96;
  const bars = useMemo(() => {
    const rawPeaks = peaks.length > 0 ? peaks : waveformBars.map((barHeight) => barHeight / 100);
    const displayPeaks = rawPeaks.map((peak) => scaleWaveformPeak(peak, scaleMode));
    const barWidth = Math.max(1, width / displayPeaks.length);

    return displayPeaks.map((peak, index) => {
      const normalizedHeight = Math.max(3, peak * height);
      return {
        height: normalizedHeight,
        key: `${index}-${peak.toFixed(3)}`,
        width: Math.max(1, barWidth * 0.72),
        x: index * barWidth,
        y: (height - normalizedHeight) / 2
      };
    });
  }, [peaks, scaleMode]);

  return (
    <svg className={`waveform ${loading ? 'loading' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <g>
        {bars.map((bar) => (
          <rect height={bar.height} key={bar.key} rx={1.5} width={bar.width} x={bar.x} y={bar.y} />
        ))}
      </g>
    </svg>
  );
});

type AudioDeckProps = {
  audioRef: MutableRefObject<HTMLMediaElement | null>;
  currentTime: number;
  diagnosticsEnabled: boolean;
  disabled: boolean;
  duration: number | null;
  externalSeekSignal: number;
  mediaError: string | null;
  mediaKind: MediaKind;
  mediaUrl: string | null;
  canGoNextSegment: boolean;
  canGoPreviousSegment: boolean;
  onClockSample: (sample: PlaybackClockSample | null) => void;
  onDurationChange: (duration: number | null) => void;
  onError: (message: string | null) => void;
  onMediaDiagnostic: (eventName: string, media: HTMLMediaElement) => void;
  onNextSegment: () => void;
  onPreviousSegment: () => void;
  onTimeChange: (time: number) => void;
  playbackSpeed: number;
  playing: boolean;
  setPlaybackSpeed: (speed: number) => void;
  setPlaying: (playing: boolean) => void;
  waveformLoading: boolean;
  waveformPeaks: number[];
};

export function AudioDeck({
  audioRef,
  currentTime,
  diagnosticsEnabled,
  disabled,
  duration,
  externalSeekSignal,
  mediaError,
  mediaKind,
  mediaUrl,
  canGoNextSegment,
  canGoPreviousSegment,
  onClockSample,
  onDurationChange,
  onError,
  onMediaDiagnostic,
  onNextSegment,
  onPreviousSegment,
  onTimeChange,
  playbackSpeed,
  playing,
  setPlaybackSpeed,
  setPlaying,
  waveformLoading,
  waveformPeaks
}: AudioDeckProps): ReactElement {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [visualTime, setVisualTime] = useState(currentTime);
  const [draftSeekTime, setDraftSeekTime] = useState<number | null>(null);
  const [waveformScaleMode, setWaveformScaleMode] = useState<WaveformScaleMode>('actual');
  const lastPlaybackSyncRef = useRef(0);
  const lastPreviewSeekRef = useRef(0);
  const syncedPlaybackTimeRef = useRef(currentTime);
  const resolvedDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
  const mediaTime = resolvedDuration ? Math.min(visualTime, resolvedDuration) : visualTime;
  const displayTime = draftSeekTime ?? mediaTime;
  const currentProgress = resolvedDuration ? Math.min(1, Math.max(0, displayTime / resolvedDuration)) : 0;
  const canPlay = !disabled && Boolean(mediaUrl) && !mediaError;
  const volumePercent = Math.round((muted ? 0 : volume) * 100);

  useEffect(() => {
    syncedPlaybackTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!canPlay) {
      audio.pause();
      if (playing) {
        setPlaying(false);
      }
      return;
    }

    if (playing) {
      void audio.play().catch(() => {
        setPlaying(false);
        onError('Media playback could not start.');
      });
    } else {
      audio.pause();
    }
  }, [audioRef, canPlay, mediaUrl, onError, playing, setPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume;
    audio.muted = muted;
  }, [audioRef, muted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.playbackRate = playbackSpeed;
  }, [audioRef, mediaUrl, playbackSpeed]);

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

  return (
    <section className="audio-deck panel-glow" aria-label="Media controls">
      {mediaKind === 'audio' ? (
        <audio
          className="playback-media"
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration;
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
          }}
          onEnded={(event) => {
            const nextTime = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : event.currentTarget.currentTime;
            setVisualTime(nextTime);
            onTimeChange(nextTime);
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            onError('Media source could not be loaded.');
          }}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration;
            event.currentTarget.playbackRate = playbackSpeed;
            setVisualTime(event.currentTarget.currentTime);
            onDurationChange(Number.isFinite(nextDuration) ? nextDuration : null);
            onTimeChange(event.currentTarget.currentTime);
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onSeeked={(event) => {
            setVisualTime(event.currentTarget.currentTime);
            recordSeekSample(event.currentTarget, event.currentTarget.currentTime);
            syncPlaybackSample(event.currentTarget.currentTime, true);
            onMediaDiagnostic('audio:seeked', event.currentTarget);
          }}
          onSeeking={(event) => onMediaDiagnostic('audio:seeking', event.currentTarget)}
          onStalled={(event) => onMediaDiagnostic('audio:stalled', event.currentTarget)}
          onWaiting={(event) => onMediaDiagnostic('audio:waiting', event.currentTarget)}
          preload="metadata"
          ref={(element) => {
            audioRef.current = element;
          }}
          src={mediaUrl ?? undefined}
        />
      ) : null}
      {mediaError ? (
        <div className="deck-error">
          <Zap size={15} />
          <span>{mediaError}</span>
        </div>
      ) : (
        <>
          <div className="deck-controls">
            <button className="icon-button" disabled={!canPlay || !canGoPreviousSegment} onClick={onPreviousSegment} title="Previous segment" type="button"><SkipBack size={18} /></button>
            <button className="play-button" disabled={!canPlay} onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} type="button">
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button className="icon-button" disabled={!canPlay || !canGoNextSegment} onClick={onNextSegment} title="Next segment" type="button"><SkipForward size={18} /></button>
          </div>
          <div className="deck-time-group" aria-label="Playback time">
            <span className="deck-time current">{formatPreciseTime(displayTime)}</span>
            <span className="deck-time-divider">/</span>
            <span className="deck-time">{formatPreciseDuration(resolvedDuration)}</span>
          </div>
          <div className="waveform-wrap">
            <div className="waveform-control">
              <WaveformGraph loading={waveformLoading} peaks={waveformPeaks} scaleMode={waveformScaleMode} />
              <div className="waveform-progress-overlay" style={{ transform: `scaleX(${currentProgress})` }} />
              <div className="waveform-playhead" style={{ left: `${currentProgress * 100}%` }} />
              <input
                aria-label="Seek media"
                className="audio-seek"
                disabled={!canPlay || !resolvedDuration}
                max={resolvedDuration ?? 0}
                min={0}
                onBlur={(event) => {
                  if (draftSeekTime !== null) {
                    seekTo(Number(event.currentTarget.value));
                  }
                }}
                onChange={(event) => previewSeek(Number(event.target.value))}
                onKeyUp={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    seekTo(Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={() => setDraftSeekTime(null)}
                onPointerDown={() => setDraftSeekTime(displayTime)}
                onPointerUp={(event) => seekTo(Number(event.currentTarget.value))}
                step={0.001}
                type="range"
                value={resolvedDuration ? Math.min(displayTime, resolvedDuration) : 0}
              />
            </div>
          </div>
          <div className="deck-option-group">
            <div className="volume-control">
              <button
                aria-expanded={volumeOpen}
                className={`volume-button ${volumeOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setVolumeOpen((open) => !open);
                  setScaleOpen(false);
                  setSpeedOpen(false);
                }}
                title="Volume"
                type="button"
              >
                {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              {volumeOpen ? (
                <div className="volume-popover">
                  <button className="volume-mute-button" onClick={() => setMuted((value) => !value)} title={muted || volume === 0 ? 'Unmute' : 'Mute'} type="button">
                    {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <input
                    aria-label="Volume"
                    className="volume-slider"
                    disabled={!mediaUrl}
                    max={1}
                    min={0}
                    onChange={(event) => {
                      const nextVolume = Number(event.target.value);
                      setVolume(nextVolume);
                      setMuted(nextVolume === 0);
                    }}
                    step={0.01}
                    type="range"
                    value={muted ? 0 : volume}
                  />
                  <span>{volumePercent}%</span>
                </div>
              ) : null}
            </div>
            <div className="speed-control">
              <button
                aria-expanded={speedOpen}
                className={`speed-button ${speedOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setSpeedOpen((open) => !open);
                  setScaleOpen(false);
                  setVolumeOpen(false);
                }}
                title="Playback speed"
                type="button"
              >
                {formatPlaybackSpeed(playbackSpeed)}
              </button>
              {speedOpen ? (
                <div className="speed-popover">
                  {playbackSpeeds.map((speed) => (
                    <button
                      className={speed === playbackSpeed ? 'active' : ''}
                      key={speed}
                      onClick={() => {
                        setPlaybackSpeed(speed);
                        setSpeedOpen(false);
                      }}
                      type="button"
                    >
                      {formatPlaybackSpeed(speed)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="waveform-scale-control">
              <button
                aria-expanded={scaleOpen}
                className={`option-button ${scaleOpen ? 'active' : ''}`}
                disabled={!mediaUrl}
                onClick={() => {
                  setScaleOpen((open) => !open);
                  setSpeedOpen(false);
                  setVolumeOpen(false);
                }}
                title={`Waveform scale: ${waveformScaleLabel(waveformScaleMode)}`}
                type="button"
              >
                <SlidersHorizontal size={15} />
              </button>
              {scaleOpen ? (
                <div className="waveform-scale-popover" aria-label="Waveform scale">
                  {waveformScaleModes.map((mode) => (
                    <button
                      className={mode === waveformScaleMode ? 'active' : ''}
                      key={mode}
                      onClick={() => {
                        setWaveformScaleMode(mode);
                        setScaleOpen(false);
                      }}
                      title={waveformScaleDescription(mode)}
                      type="button"
                    >
                      {waveformScaleLabel(mode)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
