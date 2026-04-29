import { type MutableRefObject, type ReactElement, useEffect, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX, Zap } from 'lucide-react';
import { formatPreciseDuration, formatPreciseTime } from '../../lib/format';
import { type MediaKind } from '../../lib/media-kind';
import { formatPlaybackSpeed, waveformScaleDescription, waveformScaleLabel, waveformScaleModes, type WaveformScaleMode } from '../../lib/waveform';
import { AudioMediaElement } from './audio-media-element';
import { playbackSpeeds } from './playback-constants';
import { type PlaybackClockSample, usePlaybackClock } from './playback-clock';
import { WaveformGraph } from './waveform-graph';

export type { PlaybackClockSample } from './playback-clock';

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
  const [waveformScaleMode, setWaveformScaleMode] = useState<WaveformScaleMode>('actual');
  const canPlay = !disabled && Boolean(mediaUrl) && !mediaError;
  const volumePercent = Math.round((muted ? 0 : volume) * 100);
  const playbackClock = usePlaybackClock({
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
  });

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

  return (
    <section className="audio-deck panel-glow" aria-label="Media controls">
      <AudioMediaElement
        audioRef={audioRef}
        mediaKind={mediaKind}
        mediaUrl={mediaUrl}
        onDurationChange={onDurationChange}
        onError={onError}
        onMediaDiagnostic={onMediaDiagnostic}
        onTimeChange={onTimeChange}
        playbackSpeed={playbackSpeed}
        recordSeekSample={playbackClock.recordSeekSample}
        setPlaying={setPlaying}
        setVisualTime={playbackClock.setVisualTime}
        syncPlaybackSample={playbackClock.syncPlaybackSample}
      />
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
            <span className="deck-time current">{formatPreciseTime(playbackClock.displayTime)}</span>
            <span className="deck-time-divider">/</span>
            <span className="deck-time">{formatPreciseDuration(playbackClock.resolvedDuration)}</span>
          </div>
          <div className="waveform-wrap">
            <div className="waveform-control">
              <WaveformGraph loading={waveformLoading} peaks={waveformPeaks} scaleMode={waveformScaleMode} />
              <div className="waveform-progress-overlay" style={{ transform: `scaleX(${playbackClock.currentProgress})` }} />
              <div className="waveform-playhead" style={{ left: `${playbackClock.currentProgress * 100}%` }} />
              <input
                aria-label="Seek media"
                className="audio-seek"
                disabled={!canPlay || !playbackClock.resolvedDuration}
                max={playbackClock.resolvedDuration ?? 0}
                min={0}
                onBlur={(event) => {
                  if (playbackClock.draftSeekTime !== null) {
                    playbackClock.seekTo(Number(event.currentTarget.value));
                  }
                }}
                onChange={(event) => playbackClock.previewSeek(Number(event.target.value))}
                onKeyUp={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                    playbackClock.seekTo(Number(event.currentTarget.value));
                  }
                }}
                onPointerCancel={playbackClock.clearDraftSeek}
                onPointerDown={playbackClock.startDraftSeek}
                onPointerUp={(event) => playbackClock.seekTo(Number(event.currentTarget.value))}
                step={0.001}
                type="range"
                value={playbackClock.resolvedDuration ? Math.min(playbackClock.displayTime, playbackClock.resolvedDuration) : 0}
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
